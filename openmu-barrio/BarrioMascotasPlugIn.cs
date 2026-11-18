// <copyright file="BarrioMascotasPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.Collections.Concurrent;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json.Serialization;
using MUnique.OpenMU.DataModel;
using MUnique.OpenMU.DataModel.Entities;
using MUnique.OpenMU.GameLogic.Attributes;
using MUnique.OpenMU.GameLogic.PlugIns.ChatCommands;
using MUnique.OpenMU.GameLogic.Views;
using MUnique.OpenMU.GameLogic.Views.Inventory;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: las mascotas del Sabio. Una cadena de 4 cuerpos que ya existen en el
/// juego (grupo 13): Sabio, Sabio Espíritu, Sabio Panda (+50% EXP) y Sabio Dragón
/// (+40% ataque). El Sabio del Barrio entrega el primero; evolucionan con resets
/// o con tiempo puesta. Las frases salen en el chat del MAPA, nunca global, y
/// dos mascotas máximas del mismo mapa se cargan entre sí cada 5 minutos.
/// </summary>
/// <remarks>
/// El progreso se guarda en data/mascotas-sabio.json con <see cref="BarrioStore{TValue}"/>.
/// La IA es la misma de /ia: el servidor le pide frases cortas a la API de la
/// tablet (http://127.0.0.1:3400/sabio, modo "frase"). Si la IA falla, hay frases
/// fijas. El jugador no puede pedir items ni puntos: la IA solo escribe texto.
/// </remarks>
[PlugIn]
[Display(Name = "BarrioMU: mascotas del Sabio", Description = "El Sabio entrega una mascota que evoluciona con resets o tiempo, habla en el chat del mapa y, al llegar a nivel máximo, conversa con otras mascotas.")]
[Guid("C4F5A6B7-8D9E-4F1A-B2C3-D4E5F6A7B8C9")]
public class BarrioMascotasPlugIn : IChatCommandPlugIn, IPeriodicTaskPlugIn, IPlayerStateChangedPlugIn, IChatMessageSentPlugIn
{
    private const string Command = "/mascota";

    private const string SabioName = "Sabio";

    private const byte PetGroup = 13;

    private const int MaxStage = 4;

    /// <summary>Ítems existentes del grupo 13, en orden de evolución.</summary>
    private static readonly short[] StageItem = [0, 65, 80, 64];

    private static readonly string[] StageNameValue = ["Sabio", "Sabio Espíritu", "Sabio Panda", "Sabio Dragón"];

    /// <summary>Resets totales para pasar a la etapa siguiente.</summary>
    private static readonly int[] ResetsNeeded = [1, 2, 3];

    /// <summary>Segundos con la mascota puesta para pasar a la etapa siguiente.</summary>
    private static readonly double[] SecondsNeeded = [2 * 3600, 4 * 3600, 8 * 3600];

    private static readonly BarrioStore<PetState> Store = new("mascotas-sabio");

    private static readonly ConcurrentDictionary<string, PetRuntime> States = new(StringComparer.OrdinalIgnoreCase);

    private static readonly ConcurrentDictionary<string, DateTime> PairCooldown = new(StringComparer.OrdinalIgnoreCase);

    private static readonly string ApiUrl = Environment.GetEnvironmentVariable("BARRIO_SABIO_URL") ?? "http://127.0.0.1:3400/sabio";

    private static readonly string SecretPath = Path.Combine(AppContext.BaseDirectory, "data", "sabio-secreto.txt");

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(40) };

    private DateTime _nextTick;

    private DateTime _nextBanter = DateTime.UtcNow.AddMinutes(5);

    private DateTime _nextFlush = DateTime.UtcNow.AddSeconds(30);

    private int _banterIndex;

    /// <inheritdoc />
    public string Key => Command;

    /// <inheritdoc />
    public CharacterStatus MinCharacterStatusRequirement => CharacterStatus.Normal;

    /// <inheritdoc />
    public async ValueTask HandleCommandAsync(Player player, string command)
    {
        if (player.SelectedCharacter is not { } character)
        {
            return;
        }

        var state = GetRuntime(player, character);
        var message = state.Stage switch
        {
            0 => "Todavía no tengo cuerpo. Háblame en Lorencia y te doy mi primera etapa.",
            MaxStage => $"Estoy en {StageName(MaxStage)}, la etapa máxima. +40% de ataque y ya puedo pelear con otros Sabios del mapa.",
            _ => $"Estoy en {StageName(state.Stage)} ({state.Stage}/{MaxStage}). Para evolucionar te faltan {Math.Max(0, ResetsNeeded[state.Stage - 1] - state.TotalResets)} resets o {Math.Max(0, (int)((SecondsNeeded[state.Stage - 1] - state.Seconds) / 3600))} horas puesta.",
        };

        await WhisperAsync(player, message).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public ValueTask ExecuteTaskAsync(GameContext gameContext)
    {
        var now = DateTime.UtcNow;
        if (now < this._nextTick)
        {
            return ValueTask.CompletedTask;
        }

        this._nextTick = now.AddSeconds(1);
        return ProcessAsync(gameContext, now);
    }

    /// <inheritdoc />
    public void ForceStart()
    {
        this._nextTick = DateTime.MinValue;
        this._nextBanter = DateTime.UtcNow.AddMinutes(5);
    }

    /// <inheritdoc />
    public async ValueTask PlayerStateChangedAsync(Player player, State previousState, State currentState)
    {
        if (previousState != PlayerState.CharacterSelection || currentState != PlayerState.EnteredWorld
            || player.SelectedCharacter is not { } character)
        {
            return;
        }

        var state = GetRuntime(player, character);
        state.LastTickUtc = DateTime.UtcNow;
        state.Owner = new WeakReference<Player>(player);

        if (player.Inventory?.GetItem(InventoryConstants.PetSlot) is not { } pet
            || pet.Definition is not { Group: PetGroup } || StageOf(pet.Definition.Number) != state.Stage
            || state.Stage == 0)
        {
            return;
        }

        // Un compañero no se gasta: se repara al entrar, aunque haya recibido golpes.
        var max = pet.GetMaximumDurabilityOfOnePiece();
        if (pet.Durability < max)
        {
            pet.Durability = max;
            await player.InvokeViewPlugInAsync<IItemDurabilityChangedPlugIn>(p => p.ItemDurabilityChangedAsync(pet, false)).ConfigureAwait(false);
        }
    }

    /// <inheritdoc />
    public async ValueTask ChatMessageSentAsync(Player sender, string message, ChatMessageType messageType, Player? receiver)
    {
        if (messageType != ChatMessageType.Normal
            || sender.SelectedCharacter is not { } character
            || !message.Contains(SabioName, StringComparison.OrdinalIgnoreCase)
            || playerHasOurPet(sender) is not { } pet)
        {
            return;
        }

        var stage = StageOf(pet.Definition?.Number ?? 0);
        if (stage < 1 || !States.TryGetValue(KeyOf(character), out var state))
        {
            return;
        }

        var now = DateTime.UtcNow;
        if (now - state.LastReplyUtc < TimeSpan.FromSeconds(30))
        {
            return;
        }

        state.LastReplyUtc = now;
        await AskAndSayAsync(sender, "respuesta", state, message: message).ConfigureAwait(false);
    }

    /// <summary>
    /// El Sabio entrega la primera etapa. Lo llama <see cref="BarrioSabioPlugIn"/> al hablarle.
    /// </summary>
    public static async ValueTask<bool> GiveFirstPetAsync(Player player)
    {
        if (player.Inventory?.GetItem(InventoryConstants.PetSlot) is { } current)
        {
            return StageOf(current.Definition?.Number ?? 0) > 0;
        }

        if (player.SelectedCharacter is not { } character)
        {
            return false;
        }

        if (await CreatePetAsync(player, StageItem[0]).ConfigureAwait(false) is null)
        {
            return false;
        }

        var state = GetRuntime(player, character);
        state.Stage = 1;
        state.Seconds = 0;
        state.Active = true;
        state.EquippedSinceUtc = DateTime.UtcNow;
        state.LastTickUtc = DateTime.UtcNow;
        state.Owner = new WeakReference<Player>(player);
        Flush(KeyOf(character), state);
        _ = AskAndSayAsync(player, "saludo", state);
        return true;
    }

    private static Item? playerHasOurPet(Player player)
    {
        var pet = player.Inventory?.GetItem(InventoryConstants.PetSlot);
        return pet?.Definition is { Group: PetGroup } && StageOf(pet.Definition.Number) > 0 ? pet : null;
    }

    private async ValueTask ProcessAsync(GameContext gameContext, DateTime now)
    {
        await gameContext.ForEachPlayerAsync(async player => await TickPlayerAsync(player, now).ConfigureAwait(false)).ConfigureAwait(false);

        if (now >= _nextBanter)
        {
            _nextBanter = now.AddMinutes(5);
            await RunBanterAsync(now).ConfigureAwait(false);
        }

        if (now >= _nextFlush)
        {
            _nextFlush = now.AddSeconds(30);
            foreach (var pair in States)
            {
                Flush(pair.Key, pair.Value);
            }
        }
    }

    private static async ValueTask TickPlayerAsync(Player player, DateTime now)
    {
        if (player.SelectedCharacter is not { } character)
        {
            return;
        }

        var pet = player.Inventory?.GetItem(InventoryConstants.PetSlot);
        var stage = pet?.Definition is { Group: PetGroup, Number: var number } ? StageOf(number) : 0;
        var state = GetRuntime(player, character);
        state.Owner = new WeakReference<Player>(player);
        state.MapNumber = player.CurrentMap?.Definition.Number ?? -1;

        if (stage == 0)
        {
            state.Active = false;
            state.LastTickUtc = default;
            return;
        }

        if (state.Stage != stage)
        {
            state.Stage = stage;
            state.Seconds = 0;
            state.EquippedSinceUtc = now;
        }

        if (!state.Active)
        {
            state.Active = true;
            state.EquippedSinceUtc = now;
            state.LastTickUtc = now;
            _ = AskAndSayAsync(player, "saludo", state);
        }

        var delta = state.LastTickUtc == default ? 1 : Math.Clamp((now - state.LastTickUtc).TotalSeconds, 0, 10);
        state.LastTickUtc = now;
        state.Seconds += delta;

        var resets = (int)(player.Attributes?[Stats.Resets] ?? 0);
        if (resets > state.LastResets)
        {
            state.TotalResets += resets - state.LastResets;
        }

        state.LastResets = resets;

        var level = (int)(player.Attributes?[Stats.Level] ?? 0);
        if (state.Level > 0 && level > state.Level)
        {
            state.Level = level;
            _ = AskAndSayAsync(player, "subida", state);
        }
        else if (state.Level == 0)
        {
            state.Level = level;
        }

        while (state.Stage < MaxStage && (state.TotalResets >= ResetsNeeded[state.Stage - 1] || state.Seconds >= SecondsNeeded[state.Stage - 1]))
        {
            await EvolveAsync(player, state).ConfigureAwait(false);
        }
    }

    private static async ValueTask EvolveAsync(Player player, PetRuntime state)
    {
        var old = player.Inventory?.GetItem(InventoryConstants.PetSlot);
        if (old is null || state.Stage >= MaxStage)
        {
            return;
        }

        await player.DestroyInventoryItemAsync(old).ConfigureAwait(false);
        var next = state.Stage + 1;
        if (await CreatePetAsync(player, StageItem[next - 1]).ConfigureAwait(false) is null)
        {
            // No se puede dejar al jugador sin compañero: se intenta devolver el anterior.
            await CreatePetAsync(player, StageItem[state.Stage - 1]).ConfigureAwait(false);
            return;
        }

        state.Stage = next;
        state.Seconds = 0;
        state.EquippedSinceUtc = DateTime.UtcNow;
        if (player.SelectedCharacter is { } character)
        {
            Flush(KeyOf(character), state);
        }

        await SayInMapAsync(player, StageName(next), "¡Épale, pana! Mirá cómo cambié.").ConfigureAwait(false);
        _ = AskAndSayAsync(player, "evolucion", state);
    }

    private static async ValueTask<Item?> CreatePetAsync(Player player, short number)
    {
        var definition = player.GameContext.Configuration.Items.FirstOrDefault(d => d.Group == PetGroup && d.Number == number);
        if (definition is null || player.Inventory is not { } inventory)
        {
            return null;
        }

        var item = player.PersistenceContext.CreateNew<Item>();
        item.Definition = definition;
        item.Durability = definition.Durability;
        item.Level = 0;
        item.ItemSlot = InventoryConstants.PetSlot;

        if (!await inventory.AddItemAsync(InventoryConstants.PetSlot, item).ConfigureAwait(false))
        {
            player.PersistenceContext.Detach(item);
            return null;
        }

        await player.InvokeViewPlugInAsync<IItemAppearPlugIn>(p => p.ItemAppearAsync(item)).ConfigureAwait(false);
        return item;
    }

    private ValueTask RunBanterAsync(DateTime now)
    {
        var ready = new List<PetRuntime>();
        foreach (var state in States.Values)
        {
            if (state.Stage != MaxStage || !state.Active || now - state.EquippedSinceUtc < TimeSpan.FromMinutes(1))
            {
                continue;
            }

            if (state.Owner?.TryGetTarget(out var owner) == true && owner?.CurrentMap is not null)
            {
                ready.Add(state);
            }
        }

        foreach (var group in ready.GroupBy(s => s.MapNumber))
        {
            var list = group.ToList();
            if (list.Count < 2)
            {
                continue;
            }

            var first = list[_banterIndex++ % list.Count];
            var second = list.FirstOrDefault(s => !ReferenceEquals(s, first)) ?? list[0];
            var pairKey = string.CompareOrdinal(first.Key, second.Key) < 0 ? first.Key + "|" + second.Key : second.Key + "|" + first.Key;
            if (PairCooldown.TryGetValue(pairKey, out var next) && next > now)
            {
                continue;
            }

            PairCooldown[pairKey] = now.AddMinutes(30);
            _ = BanterAsync(first, second);
            return ValueTask.CompletedTask;
        }

        return ValueTask.CompletedTask;
    }

    private static async Task BanterAsync(PetRuntime first, PetRuntime second)
    {
        if (first.Owner?.TryGetTarget(out var ownerA) is not true || second.Owner?.TryGetTarget(out var ownerB) is not true)
        {
            return;
        }

        var lines = await AskPhraseLinesAsync(ownerA, "duelo", first, StageName(second.Stage)).ConfigureAwait(false);
        if (lines.Length == 0)
        {
            return;
        }

        await SayInMapAsync(ownerA, StageName(first.Stage), lines[0]).ConfigureAwait(false);
        if (lines.Length > 1)
        {
            await SayInMapAsync(ownerB, StageName(second.Stage), lines[1]).ConfigureAwait(false);
        }
    }

    private static async Task AskAndSayAsync(Player player, string kind, PetRuntime state, string partner = "", string message = "")
    {
        var lines = await AskPhraseLinesAsync(player, kind, state, partner, message).ConfigureAwait(false);
        foreach (var line in lines)
        {
            await SayInMapAsync(player, StageName(state.Stage), line).ConfigureAwait(false);
        }
    }

    private static async ValueTask<string[]> AskPhraseLinesAsync(Player player, string kind, PetRuntime state, string partner = "", string message = "")
    {
        var fallback = Fallback(kind, state.Stage);
        var secret = ReadSecret();
        if (secret is null || player.Account is not { } account || player.SelectedCharacter is not { } character)
        {
            return fallback;
        }

        var request = new FraseRequest(
            secret,
            "frase",
            kind,
            account.LoginName ?? string.Empty,
            character.Name ?? string.Empty,
            StageName(state.Stage),
            state.Stage,
            partner,
            message);

        try
        {
            using var response = await Http.PostAsJsonAsync(ApiUrl, request).ConfigureAwait(false);
            var answer = await response.Content.ReadFromJsonAsync<SabioResponse>().ConfigureAwait(false);
            var lines = answer?.Lines?.Where(l => !string.IsNullOrWhiteSpace(l)).Take(2).ToArray() ?? [];
            return lines.Length > 0 ? lines : fallback;
        }
        catch
        {
            return fallback;
        }
    }

    private static string[] Fallback(string kind, int stage)
    {
        var name = StageName(stage);
        return kind switch
        {
            "saludo" => [$"Ya te acompaño, pana. Soy {name}."],
            "evolucion" => [$"¡Épale! Ahora soy {name}."],
            "subida" => ["¡Bien ahí, chamo! Por ese nivel vas."],
            "respuesta" => ["Estoy aquí, pana. Sigue jugando."],
            "duelo" => ["¿Tú también crees que eres el jefe? Yo ya le gané a Kundun.", "Bájale al cuento, chamo. Hasta un dragón se cansa de tanto ruido."],
            _ => [],
        };
    }

    private static async ValueTask SayInMapAsync(Player player, string sender, string text)
    {
        if (player.CurrentMap is not { } map || string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        foreach (var target in map.GetPlayers())
        {
            await target.InvokeViewPlugInAsync<IChatViewPlugIn>(p => p.ChatMessageAsync(text, sender, ChatMessageType.Normal)).ConfigureAwait(false);
        }
    }

    private static async ValueTask WhisperAsync(Player player, string text)
    {
        try
        {
            await player.InvokeViewPlugInAsync<IChatViewPlugIn>(p => p.ChatMessageAsync(text, SabioName, ChatMessageType.Whisper)).ConfigureAwait(false);
        }
        catch
        {
            // El jugador pudo salir mientras se Calculaba.
        }
    }

    private static PetRuntime GetRuntime(Player player, MUnique.OpenMU.DataModel.Entities.Character character)
    {
        var key = KeyOf(character);
        return States.GetOrAdd(key, k =>
        {
            var saved = Store.Get(k);
            var resets = (int)(player.Attributes?[Stats.Resets] ?? 0);
            return new PetRuntime
            {
                Key = k,
                Stage = saved?.Stage ?? 0,
                Seconds = saved?.Seconds ?? 0,
                // Quien ya tiene resets al recibir la mascota, ya se los cuenta.
                TotalResets = saved?.TotalResets ?? resets,
                LastResets = saved?.LastResets ?? resets,
                Level = (int)(player.Attributes?[Stats.Level] ?? 0),
            };
        });
    }

    private static string KeyOf(MUnique.OpenMU.DataModel.Entities.Character character) =>
        character.Id == Guid.Empty ? "name:" + character.Name : character.Id.ToString();

    private static void Flush(string key, PetRuntime state) =>
        Store.Update(key, _ => new PetState(state.Stage, state.Seconds, state.TotalResets, state.LastResets));

    private static int StageOf(short number) => Array.IndexOf(StageItem, number) + 1;

    private static string StageName(int stage) => stage >= 1 && stage <= MaxStage ? StageNameValue[stage - 1] : SabioName;

    private static string? ReadSecret()
    {
        try
        {
            var text = File.Exists(SecretPath) ? File.ReadAllText(SecretPath).Trim() : string.Empty;
            return text.Length >= 16 ? text : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Lo que sobrevive a un reinicio.</summary>
    public sealed record PetState(int Stage, double Seconds, int TotalResets, int LastResets);

    private sealed class PetRuntime
    {
        public string Key { get; set; } = string.Empty;

        public int Stage { get; set; }

        public double Seconds { get; set; }

        public int TotalResets { get; set; }

        public int LastResets { get; set; }

        public int Level { get; set; }

        public bool Active { get; set; }

        public short MapNumber { get; set; }

        public DateTime EquippedSinceUtc { get; set; }

        public DateTime LastTickUtc { get; set; }

        public DateTime LastReplyUtc { get; set; }

        public WeakReference<Player>? Owner { get; set; }
    }

    private sealed record FraseRequest(
        [property: JsonPropertyName("secret")] string Secret,
        [property: JsonPropertyName("mode")] string Mode,
        [property: JsonPropertyName("kind")] string Kind,
        [property: JsonPropertyName("login")] string Login,
        [property: JsonPropertyName("character")] string Character,
        [property: JsonPropertyName("pet")] string Pet,
        [property: JsonPropertyName("stage")] int Stage,
        [property: JsonPropertyName("partner")] string Partner,
        [property: JsonPropertyName("message")] string Message);

    private sealed record SabioResponse([property: JsonPropertyName("lines")] string[]? Lines);
}

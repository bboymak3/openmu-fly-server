// <copyright file="BarrioSpotsPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.Collections.Concurrent;
using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using MUnique.OpenMU.DataModel.Configuration;
using MUnique.OpenMU.GameLogic.Attributes;
using MUnique.OpenMU.GameLogic.Offline;
using MUnique.OpenMU.GameLogic.PlugIns.ChatCommands;
using MUnique.OpenMU.Pathfinding;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: spots de farmeo. El GM los guarda dentro del juego (/guardarspot Nombre [nivel N]);
/// por WhatsApp el jugador manda a su personaje (que farmea sin conexion con /offlevel) a un spot
/// ("mover 2"). Si muere en el spot revive y vuelve solo; a la tercera muerte se queda en la ciudad
/// esperando que lo muevan. Los spots quedan en data/spots.json.
/// </summary>
public static class BarrioSpots
{
    /// <summary>Muertes en el spot hasta quedarse en la ciudad.</summary>
    public const int MaxDeaths = 3;

    private static readonly string FilePath = Path.Combine(AppContext.BaseDirectory, "data", "spots.json");

    private static readonly Lock FileLock = new();

    /// <summary>Quien esta asignado a un spot (por cuenta).</summary>
    private static readonly ConcurrentDictionary<string, Assignment> Assigned = new(StringComparer.OrdinalIgnoreCase);

    static BarrioSpots()
    {
        // Quien tiene un spot sigue farmeando al revivir (lo normal de OpenMU es terminar la sesion).
        OfflineRespawnPolicy.ShouldContinue = p => p.Account?.LoginName is { } login && Assigned.ContainsKey(login);
    }

    /// <summary>Asegura que la politica de revivir este puesta (la llama cada plugin al crearse).</summary>
    public static void Init()
    {
    }

    /// <summary>Si la cuenta tiene a su personaje en un spot (o esperando en la ciudad).</summary>
    public static bool IsAssigned(string login) => Assigned.ContainsKey(login);

    /// <summary>Los spots guardados.</summary>
    public static List<Spot> Load()
    {
        lock (FileLock)
        {
            try
            {
                return File.Exists(FilePath)
                    ? JsonSerializer.Deserialize<SpotFile>(File.ReadAllText(FilePath))?.Spots ?? new List<Spot>()
                    : new List<Spot>();
            }
            catch
            {
                return new List<Spot>();
            }
        }
    }

    /// <summary>Guarda la lista de spots.</summary>
    public static void Save(List<Spot> spots)
    {
        lock (FileLock)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            var tmp = FilePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(new SpotFile(spots)));
            File.Move(tmp, FilePath, true);
        }
    }

    /// <summary>Lleva al personaje al spot y fija ahi su punto de caza.</summary>
    public static async ValueTask<bool> MoveAsync(OfflinePlayer player, Spot spot)
    {
        var map = player.GameContext.Configuration.Maps.FirstOrDefault(m => m.Number == spot.Map);
        if (map is null)
        {
            return false;
        }

        var gate = new ExitGate
        {
            Map = map,
            X1 = (byte)Math.Max(0, spot.X - 1),
            Y1 = (byte)Math.Max(0, spot.Y - 1),
            X2 = (byte)Math.Min(255, spot.X + 1),
            Y2 = (byte)Math.Min(255, spot.Y + 1),
            Direction = Direction.South,
        };
        await player.WarpToAsync(gate).ConfigureAwait(false);
        player.HuntingOrigin = new Point(spot.X, spot.Y);
        return true;
    }

    /// <summary>La orden "mover" de la API (WhatsApp): el spot va en Text.</summary>
    internal static async ValueTask<bool> HandleMoveOrderAsync(GameContext gameContext, string login, string? spotId)
    {
        if (!gameContext.OfflinePlayerManager.TryGetPlayer(login, out var player) || player is null)
        {
            return false; // No farmea en este servidor de juego.
        }

        var spot = Load().FirstOrDefault(s => s.Id.ToString() == spotId);
        var name = player.SelectedCharacter?.Name ?? "Tu personaje";
        if (spot is null)
        {
            BarrioAvisosPlugIn.Send(login, "Ese spot ya no existe. Escribe *spots* para ver la lista.");
            return true;
        }

        var level = (int)(player.Attributes?[Stats.Level] ?? 0);
        if (level < spot.Level)
        {
            BarrioAvisosPlugIn.Send(login, $"*{name}* es nivel {level} y *{spot.Name}* pide nivel {spot.Level}. Elige otro spot.");
            return true;
        }

        if (!player.IsAlive)
        {
            BarrioAvisosPlugIn.Send(login, $"*{name}* esta muerto ahora mismo. Intenta en unos segundos.");
            return true;
        }

        try
        {
            if (!await MoveAsync(player, spot).ConfigureAwait(false))
            {
                BarrioAvisosPlugIn.Send(login, $"No pude llevar a *{name}* a *{spot.Name}* (el mapa no existe).");
                return true;
            }

            Assigned[login] = new Assignment(spot.Id, 0, false);
            BarrioAvisosPlugIn.Send(login, $"✅ *{name}* ya esta en *{spot.Name}* farmeando. Si muere, vuelve solo (hasta {MaxDeaths} veces).");
        }
        catch
        {
            BarrioAvisosPlugIn.Send(login, $"No pude mover a *{name}*. Intenta en un rato.");
        }

        return true;
    }

    /// <summary>Murio un personaje que farmea sin conexion: si estaba en un spot, cuenta la muerte.</summary>
    internal static bool OnDeath(OfflinePlayer player)
    {
        if (player.Account?.LoginName is not { } login || !Assigned.TryGetValue(login, out var a))
        {
            return false;
        }

        if (a.Waiting)
        {
            return true; // Ya esta esperando en la ciudad: no hace falta otro aviso.
        }

        var name = player.SelectedCharacter?.Name ?? "Tu personaje";
        var spot = Load().FirstOrDefault(s => s.Id == a.SpotId);
        var deaths = a.Deaths + 1;
        if (deaths >= MaxDeaths || spot is null)
        {
            Assigned[login] = a with { Deaths = deaths, Waiting = true, ReturnPending = false };
            BarrioAvisosPlugIn.Send(login, $"💀 *{name}* murio {deaths} veces en *{spot?.Name ?? "su spot"}*. Lo deje en la ciudad esperando: escribe *spots* y *mover N* para mandarlo a otro lado (o *parar*).");
        }
        else
        {
            Assigned[login] = a with { Deaths = deaths, ReturnPending = true };
            BarrioAvisosPlugIn.Send(login, $"💀 *{name}* murio en *{spot.Name}* ({deaths}/{MaxDeaths}). Al revivir lo devuelvo al spot.");
        }

        return true;
    }

    /// <summary>Cada pocos segundos: devuelve al spot a quien ya revivio.</summary>
    internal static async ValueTask ReturnRevivedAsync(GameContext gameContext)
    {
        foreach (var (login, a) in Assigned)
        {
            if (!a.ReturnPending)
            {
                continue;
            }

            if (!gameContext.OfflinePlayerManager.TryGetPlayer(login, out var player) || player is null
                || !player.IsAlive || player.CurrentMap is null)
            {
                continue;
            }

            var spot = Load().FirstOrDefault(s => s.Id == a.SpotId);
            Assigned[login] = a with { ReturnPending = false };
            if (spot is not null)
            {
                try
                {
                    await MoveAsync(player, spot).ConfigureAwait(false);
                }
                catch
                {
                    Assigned[login] = a with { ReturnPending = false, Waiting = true };
                }
            }
        }
    }

    /// <summary>Ya no farmea (se paro o entro al juego): se olvida su spot.</summary>
    internal static void Forget(GameContext gameContext)
    {
        foreach (var login in Assigned.Keys)
        {
            if (!gameContext.OfflinePlayerManager.IsActive(login) && !OtherContextHas(login))
            {
                Assigned.TryRemove(login, out _);
            }
        }
    }

    private static readonly ConcurrentDictionary<string, DateTime> SeenActive = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Lo vio activo algun servidor de juego hace poco (hay dos en el mismo proceso).</summary>
    internal static void MarkActive(GameContext gameContext)
    {
        foreach (var p in gameContext.OfflinePlayerManager.OfflinePlayers)
        {
            if (p.Account?.LoginName is { } login)
            {
                SeenActive[login] = DateTime.UtcNow;
            }
        }
    }

    private static bool OtherContextHas(string login) =>
        SeenActive.TryGetValue(login, out var at) && DateTime.UtcNow - at < TimeSpan.FromSeconds(30);

    /// <summary>Un spot de farmeo.</summary>
    public sealed record Spot(
        [property: JsonPropertyName("id")] int Id,
        [property: JsonPropertyName("nombre")] string Name,
        [property: JsonPropertyName("mapa")] short Map,
        [property: JsonPropertyName("mapaNombre")] string MapName,
        [property: JsonPropertyName("x")] byte X,
        [property: JsonPropertyName("y")] byte Y,
        [property: JsonPropertyName("nivel")] int Level);

    private sealed record SpotFile([property: JsonPropertyName("spots")] List<Spot> Spots);

    private sealed record Assignment(int SpotId, int Deaths, bool Waiting, bool ReturnPending = false);
}

/// <summary>BarrioMU: tareas de los spots (devolver al spot a quien revivio) y contar muertes.</summary>
[PlugIn]
[Display(Name = "BarrioMU: spots de farmeo", Description = "Spots de farmeo (data/spots.json): mover por WhatsApp a quien farmea con /offlevel, volver al spot al revivir y quedarse en la ciudad tras 3 muertes.")]
[Guid("9E0F1A2B-3C4D-4E5F-8A6B-7C8D9E0F1A34")]
public class BarrioSpotsPlugIn : IPeriodicTaskPlugIn, IAttackableGotKilledPlugIn
{
    private static readonly ConditionalWeakTable<GameContext, StrongBox<DateTime>> CheckedAt = new();

    /// <summary>Initializes a new instance of the <see cref="BarrioSpotsPlugIn"/> class.</summary>
    public BarrioSpotsPlugIn() => BarrioSpots.Init();

    /// <inheritdoc />
    public async ValueTask ExecuteTaskAsync(GameContext gameContext)
    {
        var checkedAt = CheckedAt.GetOrCreateValue(gameContext);
        if (DateTime.UtcNow - checkedAt.Value < TimeSpan.FromSeconds(3))
        {
            return;
        }

        checkedAt.Value = DateTime.UtcNow;
        BarrioSpots.MarkActive(gameContext);
        await BarrioSpots.ReturnRevivedAsync(gameContext).ConfigureAwait(false);
        BarrioSpots.Forget(gameContext);
    }

    /// <inheritdoc />
    public void ForceStart()
    {
    }

    /// <inheritdoc />
    public ValueTask AttackableGotKilledAsync(IAttackable killed, IAttacker? killer)
    {
        if (killed is OfflinePlayer player)
        {
            BarrioSpots.OnDeath(player);
        }

        return ValueTask.CompletedTask;
    }
}

/// <summary>BarrioMU: /guardarspot Nombre [nivel N] (GM), guarda la posicion actual como spot.</summary>
[PlugIn]
[Display(Name = "BarrioMU: /guardarspot", Description = "GM: guarda la posicion actual como spot de farmeo: /guardarspot Jaula 1 nivel 200")]
[Guid("0F1A2B3C-4D5E-4F6A-9B7C-8D9E0F1A2B45")]
public class BarrioSaveSpotChatCommandPlugIn : IChatCommandPlugIn
{
    /// <inheritdoc />
    public string Key => "/guardarspot";

    /// <inheritdoc />
    public CharacterStatus MinCharacterStatusRequirement => CharacterStatus.GameMaster;

    /// <inheritdoc />
    public async ValueTask HandleCommandAsync(Player player, string command)
    {
        var text = command.Length > Key.Length ? command[Key.Length..].Trim() : string.Empty;
        var level = 0;
        var m = System.Text.RegularExpressions.Regex.Match(text, @"\s+nivel\s+(\d{1,4})$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (m.Success)
        {
            level = int.Parse(m.Groups[1].Value);
            text = text[..m.Index].Trim();
        }

        if (text.Length is < 2 or > 30 || player.CurrentMap is not { } map)
        {
            await player.ShowBlueMessageAsync("Uso: /guardarspot Nombre (opcional: nivel 200). Guarda donde estas parado.").ConfigureAwait(false);
            return;
        }

        var spots = BarrioSpots.Load();
        spots.RemoveAll(s => s.Name.Equals(text, StringComparison.OrdinalIgnoreCase));
        var id = spots.Count == 0 ? 1 : spots.Max(s => s.Id) + 1;
        var spot = new BarrioSpots.Spot(id, text, map.Definition.Number, (map.Definition.Name.ToString() ?? "Mapa").Split("||")[0], player.Position.X, player.Position.Y, level);
        spots.Add(spot);
        BarrioSpots.Save(spots);
        await player.ShowBlueMessageAsync($"Spot {id} guardado: {text} ({spot.MapName} {spot.X},{spot.Y}{(level > 0 ? $", nivel {level}" : string.Empty)}).").ConfigureAwait(false);
    }
}

/// <summary>BarrioMU: /quitarspot Nombre (GM).</summary>
[PlugIn]
[Display(Name = "BarrioMU: /quitarspot", Description = "GM: borra un spot de farmeo: /quitarspot Jaula 1")]
[Guid("1A2B3C4D-5E6F-4A7B-8C8D-9E0F1A2B3C56")]
public class BarrioRemoveSpotChatCommandPlugIn : IChatCommandPlugIn
{
    /// <inheritdoc />
    public string Key => "/quitarspot";

    /// <inheritdoc />
    public CharacterStatus MinCharacterStatusRequirement => CharacterStatus.GameMaster;

    /// <inheritdoc />
    public async ValueTask HandleCommandAsync(Player player, string command)
    {
        var text = command.Length > Key.Length ? command[Key.Length..].Trim() : string.Empty;
        var spots = BarrioSpots.Load();
        var removed = spots.RemoveAll(s => s.Name.Equals(text, StringComparison.OrdinalIgnoreCase) || s.Id.ToString() == text);
        if (removed == 0)
        {
            await player.ShowBlueMessageAsync($"No hay un spot \"{text}\". Escribe /spots para ver la lista.").ConfigureAwait(false);
            return;
        }

        BarrioSpots.Save(spots);
        await player.ShowBlueMessageAsync($"Spot \"{text}\" borrado.").ConfigureAwait(false);
    }
}

/// <summary>BarrioMU: /spots, la lista de spots de farmeo.</summary>
[PlugIn]
[Display(Name = "BarrioMU: /spots", Description = "Lista los spots de farmeo (se usan por WhatsApp con mover N).")]
[Guid("2B3C4D5E-6F7A-4B8C-9D9E-0F1A2B3C4D67")]
public class BarrioListSpotsChatCommandPlugIn : IChatCommandPlugIn
{
    /// <inheritdoc />
    public string Key => "/spots";

    /// <inheritdoc />
    public CharacterStatus MinCharacterStatusRequirement => CharacterStatus.Normal;

    /// <inheritdoc />
    public async ValueTask HandleCommandAsync(Player player, string command)
    {
        var spots = BarrioSpots.Load();
        if (spots.Count == 0)
        {
            await player.ShowBlueMessageAsync("Todavia no hay spots de farmeo.").ConfigureAwait(false);
            return;
        }

        foreach (var s in spots.Take(15))
        {
            await player.ShowBlueMessageAsync($"{s.Id}. {s.Name} ({s.MapName} {s.X},{s.Y}){(s.Level > 0 ? $" nivel {s.Level}+" : string.Empty)}").ConfigureAwait(false);
        }

        await player.ShowBlueMessageAsync("Farmea con MU Helper + /offlevel y muevete por WhatsApp: mover N").ConfigureAwait(false);
    }
}

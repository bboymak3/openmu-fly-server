// <copyright file="BarrioAvisosPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.Collections.Concurrent;
using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using MUnique.OpenMU.GameLogic.Attributes;
using MUnique.OpenMU.GameLogic.NPC;
using MUnique.OpenMU.GameLogic.Offline;
using MUnique.OpenMU.GameLogic.Resets;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: lo que el servidor de juego le cuenta a la API de la tablet.
/// </summary>
/// <remarks>
/// <para>
/// 1. Quien esta dentro del juego: cada 10 segundos escribe data/en-juego.json con las cuentas
///    que tiene cargadas, tambien las que farmean sin conexion (/offlevel, en "offline"). La API
///    no toca una cuenta que este ahi: el juego la guardaria encima al salir.
///    Y cumple las ordenes de la API (data/ordenes/*.json): "parar" detiene el farmeo sin conexion.
/// </para>
/// <para>
/// 2. Avisos por WhatsApp (el Sabio): cuando un personaje que farmea sin conexion llega al nivel
///    del reset, o muere farmeando. Se mandan a la API (http://127.0.0.1:3400/aviso) con el
///    secreto del Sabio; la API los manda al WhatsApp vinculado a la cuenta, si hay.
/// </para>
/// </remarks>
[PlugIn]
[Display(Name = "BarrioMU: avisos y cuentas en el juego", Description = "Escribe data/en-juego.json (cuentas cargadas en el juego, tambien /offlevel) y manda avisos por WhatsApp: reset listo y muerte farmeando sin conexion.")]
[Guid("7C8D9E0F-1A2B-4C3D-8E4F-5A6B7C8D9E02")]
public class BarrioAvisosPlugIn : IPeriodicTaskPlugIn, ICharacterLevelUpPlugIn, IAttackableGotKilledPlugIn
{
    private static readonly string DataDir = Path.Combine(AppContext.BaseDirectory, "data");

    private static readonly string InGamePath = Path.Combine(DataDir, "en-juego.json");

    private static readonly string SecretPath = Path.Combine(DataDir, "sabio-secreto.txt");

    private static readonly string AvisoUrl = Environment.GetEnvironmentVariable("BARRIO_AVISO_URL") ?? "http://127.0.0.1:3400/aviso";

    private static readonly TimeSpan WriteEvery = TimeSpan.FromSeconds(10);

    private static readonly TimeSpan DeathEvery = TimeSpan.FromMinutes(10);

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    /// <summary>Las cuentas cargadas en cada servidor de juego (hay dos en el mismo proceso).</summary>
    private static readonly ConditionalWeakTable<GameContext, string[]> LoginsByServer = new();

    /// <summary>Las cuentas que farmean sin conexion (/offlevel) en cada servidor de juego.</summary>
    private static readonly ConditionalWeakTable<GameContext, string[]> OfflineByServer = new();

    /// <summary>Ordenes de la API (WhatsApp): un archivo .json por orden.</summary>
    private static readonly string OrdersDir = Path.Combine(DataDir, "ordenes");

    private static readonly TimeSpan OrderMaxAge = TimeSpan.FromMinutes(3);

    /// <summary>Cuando se miro por ultima vez cada servidor de juego.</summary>
    private static readonly ConditionalWeakTable<GameContext, StrongBox<DateTime>> CheckedAt = new();

    /// <summary>Para no repetir: "personaje:resets" ya avisado, y el ultimo aviso de muerte por cuenta.</summary>
    private static readonly ConcurrentDictionary<string, DateTime> Sent = new(StringComparer.OrdinalIgnoreCase);

    private static DateTime nextWrite = DateTime.MinValue;

    /// <inheritdoc />
    public async ValueTask ExecuteTaskAsync(GameContext gameContext)
    {
        var checkedAt = CheckedAt.GetOrCreateValue(gameContext);
        if (DateTime.UtcNow - checkedAt.Value < TimeSpan.FromSeconds(5))
        {
            return;
        }

        checkedAt.Value = DateTime.UtcNow;
        var players = await gameContext.GetPlayersAsync().ConfigureAwait(false);
        LoginsByServer.AddOrUpdate(
            gameContext,
            players
                .Select(p => p.Account?.LoginName)
                .Where(l => !string.IsNullOrEmpty(l))
                .Select(l => l!)
                .ToArray());
        OfflineByServer.AddOrUpdate(
            gameContext,
            gameContext.OfflinePlayerManager.OfflinePlayers
                .Select(p => p.Account?.LoginName)
                .Where(l => !string.IsNullOrEmpty(l))
                .Select(l => l!)
                .ToArray());

        await RunOrdersAsync(gameContext).ConfigureAwait(false);

        if (DateTime.UtcNow < nextWrite)
        {
            return;
        }

        nextWrite = DateTime.UtcNow + WriteEvery;
        try
        {
            Directory.CreateDirectory(DataDir);
            var all = LoginsByServer.SelectMany(pair => pair.Value).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var offline = OfflineByServer.SelectMany(pair => pair.Value).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var json = JsonSerializer.Serialize(new InGame(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), all, offline));
            var tmp = InGamePath + ".tmp";
            await File.WriteAllTextAsync(tmp, json).ConfigureAwait(false);
            File.Move(tmp, InGamePath, true);
        }
        catch
        {
            // Sin archivo, la API cree que nadie esta: por eso ella exige que sea reciente.
        }
    }

    /// <summary>
    /// Cumple las ordenes de la API que le tocan a este servidor de juego. Hoy: "parar" (detiene
    /// el farmeo sin conexion de la cuenta; el juego guarda al personaje). La orden se borra antes
    /// de cumplirla, asi no se hace dos veces.
    /// </summary>
    private static async ValueTask RunOrdersAsync(GameContext gameContext)
    {
        string[] files;
        try
        {
            files = Directory.Exists(OrdersDir) ? Directory.GetFiles(OrdersDir, "*.json") : Array.Empty<string>();
        }
        catch
        {
            return;
        }

        foreach (var file in files)
        {
            Order? order;
            try
            {
                order = JsonSerializer.Deserialize<Order>(await File.ReadAllTextAsync(file).ConfigureAwait(false));
            }
            catch
            {
                TryDelete(file);
                continue;
            }

            var age = DateTimeOffset.UtcNow - DateTimeOffset.FromUnixTimeMilliseconds(order?.At ?? 0);
            if (order?.Login is not { Length: > 0 } login || age > OrderMaxAge)
            {
                if (order?.Login is { Length: > 0 } late && order.Accion == "parar")
                {
                    Send(late, "No encontre tu personaje farmeando para pararlo. Si sigue farmeando, entra al juego y sal.");
                }

                TryDelete(file);
                continue;
            }

            if (order.Accion != "parar" || !gameContext.OfflinePlayerManager.IsActive(login))
            {
                continue; // Puede ser del otro servidor de juego: se queda hasta que venza.
            }

            if (!TryDelete(file))
            {
                continue; // El otro servidor de juego ya la tomo.
            }

            gameContext.OfflinePlayerManager.TryGetPlayer(login, out var farming);
            var name = farming?.SelectedCharacter?.Name ?? "Tu personaje";
            try
            {
                await gameContext.OfflinePlayerManager.StopAsync(login).ConfigureAwait(false);
                Send(login, $"🛑 Farmeo detenido: *{name}* quedo guardado y fuera del juego. En un minuto ya puedes hacer reset o vender por aqui.");
            }
            catch
            {
                Send(login, "No pude parar el farmeo. Entra al juego y sal para detenerlo.");
            }
        }
    }

    private static bool TryDelete(string file)
    {
        try
        {
            File.Delete(file);
            return !File.Exists(file);
        }
        catch
        {
            return false;
        }
    }

    /// <inheritdoc />
    public void ForceStart()
    {
    }

    /// <inheritdoc />
    public void CharacterLeveledUp(Player player)
    {
        if (player is not OfflinePlayer || player.SelectedCharacter is not { } character || player.Account?.LoginName is not { } login)
        {
            return;
        }

        var required = player.GameContext.FeaturePlugIns.GetPlugIn<ResetFeaturePlugIn>()?.Configuration?.RequiredLevel ?? 0;
        var level = (int)(player.Attributes?[Stats.Level] ?? 0);
        var resets = (int)(player.Attributes?[Stats.Resets] ?? 0);
        if (required <= 0 || level < required || !Sent.TryAdd($"{character.Name}:{resets}", DateTime.UtcNow))
        {
            return;
        }

        Send(login, $"⬆️ *{character.Name}* llegó a nivel {level} farmeando sin conexión: ya puede hacer *reset*. Entra al juego y escribe /reset (o sal del juego del todo y escríbeme *reset {character.Name}*).");
    }

    /// <inheritdoc />
    public ValueTask AttackableGotKilledAsync(IAttackable killed, IAttacker? killer)
    {
        if (killed is not OfflinePlayer player || player.SelectedCharacter is not { } character || player.Account?.LoginName is not { } login)
        {
            return ValueTask.CompletedTask;
        }

        var key = "muerte:" + login;
        if (Sent.TryGetValue(key, out var last) && DateTime.UtcNow - last < DeathEvery)
        {
            return ValueTask.CompletedTask;
        }

        Sent[key] = DateTime.UtcNow;
        var map = player.CurrentMap?.Definition.Name.ToString() ?? "su mapa";
        var by = (killer as Monster)?.Definition.Designation.ToString();
        Send(login, $"💀 *{character.Name}* murió farmeando sin conexión en {map}{(string.IsNullOrEmpty(by) ? string.Empty : $" ({by})")}. Revisa el MU Helper o cambia de spot.");
        return ValueTask.CompletedTask;
    }

    private static void Send(string login, string text)
    {
        string secret;
        try
        {
            secret = File.Exists(SecretPath) ? File.ReadAllText(SecretPath).Trim() : string.Empty;
        }
        catch
        {
            return;
        }

        if (secret.Length < 16)
        {
            return;
        }

        _ = Task.Run(async () =>
        {
            try
            {
                using var response = await Http.PostAsJsonAsync(AvisoUrl, new Aviso(secret, login, text)).ConfigureAwait(false);
            }
            catch
            {
                // Sin API o sin WhatsApp: el aviso se pierde, el juego sigue igual.
            }
        });
    }

    private sealed record InGame(
        [property: JsonPropertyName("at")] long At,
        [property: JsonPropertyName("logins")] string[] Logins,
        [property: JsonPropertyName("offline")] string[] Offline);

    private sealed record Order([property: JsonPropertyName("accion")] string? Accion, [property: JsonPropertyName("login")] string? Login, [property: JsonPropertyName("at")] long At);

    private sealed record Aviso(
        [property: JsonPropertyName("secret")] string Secret,
        [property: JsonPropertyName("login")] string Login,
        [property: JsonPropertyName("text")] string Text);
}

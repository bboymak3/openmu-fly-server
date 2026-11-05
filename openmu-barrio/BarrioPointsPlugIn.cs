// <copyright file="BarrioPointsPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using MUnique.OpenMU.GameLogic.NPC;
using MUnique.OpenMU.GameLogic.Views.Inventory;
using MUnique.OpenMU.GameLogic.Views.NPC;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: points for the golden invasion monsters and the bosses, spent in the
/// points shop of the web (Mi cuenta). The points are the account's Goblin Points.
/// How many points each monster gives is in data/puntos.json (monster number: points),
/// written with the defaults below the first time and edited from the admin panel;
/// it is read again when it changes.
/// The "Cambista" NPC in Lorencia also changes zen of the character for WCoinP of the
/// account: the server does it itself, so it can not be duplicated. How much one WCoinP
/// costs, how many can be changed in one click and the daily limit are in
/// data/cambista.json; the amounts changed of the day are kept in data/cambio-zen.json,
/// with the day in the time of Venezuela (UTC-4).
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: puntos por dorados y jefes", Description = "Da puntos (Goblin Points) al matar los monstruos dorados de la invasion y los jefes; el NPC Cambista de Lorencia los muestra y ademas cambia zen por WCoinP.")]
[Guid("3F7B2C1D-8E4A-4B6C-9D0E-1A2B3C4D5E71")]
public class BarrioPointsPlugIn : IAttackableGotKilledPlugIn, IObjectAddedToMapPlugIn, IPlayerTalkToNpcPlugIn
{
    /// <summary>The NPC of the Cambista: Golden Archer, the one of the golden things.</summary>
    private const short CambistaNpcNumber = 236;

    private const short LorenciaMapNumber = 0;

    private const byte CambistaX = 142;

    private const byte CambistaY = 124;

    private static readonly TimeSpan ReloadEvery = TimeSpan.FromSeconds(30);

    /// <summary>Monster number and points, when there is no data/puntos.json yet.</summary>
    private static readonly Dictionary<string, int> Defaults = new()
    {
        // Golden invasion (and the other invasions' leaders)
        ["43"] = 1, // Golden Budge Dragon
        ["78"] = 2, // Golden Goblin
        ["54"] = 2, // Golden Soldier
        ["53"] = 3, // Golden Titan
        ["80"] = 3, // Golden Lizard King
        ["81"] = 3, // Golden Vepar
        ["82"] = 3, // Golden Tantallos
        ["83"] = 3, // Golden Wheel
        ["79"] = 5, // Golden Dragon
        ["44"] = 5, // Red Dragon
        ["135"] = 10, // White Wizard
        // Bosses
        ["77"] = 20, // Phoenix of Darkness (Icarus)
        ["161"] = 10, // Illusion of Kundun 1 (Kalima 1)
        ["181"] = 15, // Illusion of Kundun 2
        ["189"] = 20, // Illusion of Kundun 3
        ["197"] = 25, // Illusion of Kundun 4
        ["267"] = 30, // Illusion of Kundun 5
        ["338"] = 40, // Illusion of Kundun 6
        ["275"] = 50, // Kundun (Kalima 7)
        ["295"] = 30, // Erohim (Land of Trials)
        ["349"] = 50, // Balgass (Crywolf)
        ["361"] = 50, // Nightmare (Kanturu)
        ["362"] = 20, // Maya's left hand (Kanturu)
        ["363"] = 20, // Maya's right hand (Kanturu)
        ["459"] = 50, // Selupan (Raklion)
    };

    private static readonly string FilePath = Path.Combine(AppContext.BaseDirectory, "data", "puntos.json");

    private static readonly Lock TableLock = new();

    private static readonly ConditionalWeakTable<NonPlayerCharacter, object> OwnNpcs = new();

    private static readonly ConditionalWeakTable<GameMap, object> SpawnedMaps = new();

    private static readonly SemaphoreSlim SpawnLock = new(1, 1);

    private static Dictionary<string, int> table = new(Defaults);

    private static DateTime checkedAt = DateTime.MinValue;

    private static DateTime fileTime = DateTime.MinValue;

    /// <summary>The day changes at midnight in Venezuela (UTC-4), as in the premio diario.</summary>
    private static readonly TimeSpan ServerTimeOffset = TimeSpan.FromHours(-4);

    /// <summary>How much one WCoinP costs, while there is no data/cambista.json yet.</summary>
    private static readonly CambistaRule CambistaDefaults = new(ZenPerWcoinP: 10_000_000, MaxPerClick: 5, DailyCap: 20);

    private static readonly string CambistaFilePath = Path.Combine(AppContext.BaseDirectory, "data", "cambista.json");

    private static readonly BarrioStore<CambistaState> CambistaStore = new("cambio-zen");

    private static readonly Lock CambistaLock = new();

    private static CambistaRule cambistaRule = CambistaDefaults;

    private static DateTime cambistaCheckedAt = DateTime.MinValue;

    private static DateTime cambistaFileTime = DateTime.MinValue;

    /// <inheritdoc />
    public async ValueTask AttackableGotKilledAsync(IAttackable killed, IAttacker? killer)
    {
        // The player, or the owner of the summon that made the kill. A summon killed gives nothing.
        var player = killer as Player ?? (killer as Monster)?.SummonedBy;
        if (killed is not Monster monster || monster.SummonedBy is not null || player?.Account is not { } account)
        {
            return;
        }

        var points = PointsFor(monster.Definition.Number);
        if (points <= 0)
        {
            return;
        }

        account.GoblinPoints = (int)Math.Min((long)account.GoblinPoints + points, int.MaxValue);
        var name = monster.Definition.Designation.ToString();
        await player.ShowBlueMessageAsync($"+{points} puntos por {name}. Tienes {account.GoblinPoints} puntos (Cambista en Lorencia).").ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async ValueTask ObjectAddedToMapAsync(GameMap map, ILocateable addedObject)
    {
        if (addedObject is not Player player || map.Definition.Number != LorenciaMapNumber || SpawnedMaps.TryGetValue(map, out _))
        {
            return;
        }

        await SpawnLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (SpawnedMaps.TryGetValue(map, out _))
            {
                return;
            }

            SpawnedMaps.Add(map, new object());
            var definition = player.GameContext.Configuration.Monsters.FirstOrDefault(m => m.Number == CambistaNpcNumber);
            if (definition is null)
            {
                return;
            }

            var area = new MonsterSpawnArea
            {
                GameMap = map.Definition,
                MonsterDefinition = definition,
                X1 = (byte)(CambistaX - 1),
                Y1 = (byte)(CambistaY - 1),
                X2 = (byte)(CambistaX + 1),
                Y2 = (byte)(CambistaY + 1),
                Quantity = 1,
                Direction = Direction.South,
            };
            var npc = new NonPlayerCharacter(area, definition, map);
            try
            {
                npc.Initialize();
            }
            catch (InvalidOperationException)
            {
                await npc.DisposeAsync().ConfigureAwait(false);
                return;
            }

            OwnNpcs.AddOrUpdate(npc, new object());
            await map.AddAsync(npc).ConfigureAwait(false);
            npc.OnSpawn();
        }
        finally
        {
            SpawnLock.Release();
        }
    }

    /// <inheritdoc />
    public async ValueTask PlayerTalksToNpcAsync(Player player, NonPlayerCharacter npc, NpcTalkEventArgs eventArgs)
    {
        if (!OwnNpcs.TryGetValue(npc, out _) || player.Account is not { } account)
        {
            return;
        }

        eventArgs.HasBeenHandled = true;
        await ExchangeZenAsync(player, npc, account).ConfigureAwait(false);
        await player.InvokeViewPlugInAsync<IShowMessageOfObjectPlugIn>(p => p.ShowMessageOfObjectAsync($"Tienes {account.GoblinPoints} puntos.", npc)).ConfigureAwait(false);
        await player.ShowBlueMessageAsync($"Cambista: tienes {account.GoblinPoints} puntos. Los ganas matando monstruos dorados y jefes.").ConfigureAwait(false);
        await player.ShowBlueMessageAsync("Cambialos en barriomu.makeseo.app > Mi cuenta > Tienda de puntos (fuera del juego).").ConfigureAwait(false);
    }

    /// <summary>
    /// Changes the zen of the character for WCoinP of the account; the server does it
    /// itself, so it can not go duplicated. One click changes as much zen as buys,
    /// up to the max per click and to the daily limit of the account.
    /// </summary>
    private static async ValueTask ExchangeZenAsync(Player player, NonPlayerCharacter npc, MUnique.OpenMU.DataModel.Entities.Account account)
    {
        var rule = ReadCambistaRule();
        var login = account.LoginName ?? string.Empty;
        if (rule.ZenPerWcoinP <= 0 || string.IsNullOrEmpty(login))
        {
            return;
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow + ServerTimeOffset);
        var state = CambistaStore.Get(login);
        if (state?.Day != today)
        {
            state = new CambistaState(today, 0);
        }

        var left = Math.Max(0, rule.DailyCap - state.Got);
        var byZen = (int)((long)player.Money / rule.ZenPerWcoinP);
        var amount = Math.Min(left, Math.Min(byZen, rule.MaxPerClick));
        var cost = checked(amount * rule.ZenPerWcoinP);
        if (amount <= 0)
        {
            if (left <= 0)
            {
                await player.ShowBlueMessageAsync($"Cambista: hoy cambiaste {state.Got} WCoinP (tope {rule.DailyCap}). Vuelve manana.").ConfigureAwait(false);
            }
            else
            {
                var missing = rule.ZenPerWcoinP - player.Money;
                await player.InvokeViewPlugInAsync<IShowMessageOfObjectPlugIn>(p => p.ShowMessageOfObjectAsync($"{rule.ZenPerWcoinP:N0} zen = 1 WCoinP", npc)).ConfigureAwait(false);
                await player.ShowBlueMessageAsync($"Cambista: cambio {rule.ZenPerWcoinP:N0} zen por 1 WCoinP (tope {rule.DailyCap} por dia). Te faltan {missing:N0} zen.").ConfigureAwait(false);
            }

            return;
        }

        if (!player.TryRemoveMoney(cost))
        {
            return;
        }

        if (!CambistaStore.Update(login, _ => state with { Got = state.Got + amount }))
        {
            // Without the counter written the change is not handed out (better keep the zen).
            player.TryAddMoney(cost);
            return;
        }

        account.WCoinP = (int)Math.Min((long)account.WCoinP + amount, int.MaxValue);
        await player.InvokeViewPlugInAsync<IUpdateMoneyPlugIn>(p => p.UpdateMoneyAsync()).ConfigureAwait(false);
        await player.InvokeViewPlugInAsync<IShowMessageOfObjectPlugIn>(p => p.ShowMessageOfObjectAsync($"+{amount} WCoinP", npc)).ConfigureAwait(false);
        var leftAfter = Math.Max(0, rule.DailyCap - state.Got - amount);
        await player.ShowBlueMessageAsync($"Cambista: -{cost:N0} zen, +{amount} WCoinP (hoy {state.Got + amount} de {rule.DailyCap}; quedan {leftAfter}). Gasta en barriomu.makeseo.app > La Plaza.").ConfigureAwait(false);
    }

    /// <summary>The rule of the change, from data/cambista.json (read again when it changed).</summary>
    private static CambistaRule ReadCambistaRule()
    {
        lock (CambistaLock)
        {
            var now = DateTime.UtcNow;
            if (now - cambistaCheckedAt > ReloadEvery)
            {
                cambistaCheckedAt = now;
                try
                {
                    if (!File.Exists(CambistaFilePath))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(CambistaFilePath)!);
                        File.WriteAllText(CambistaFilePath, JsonSerializer.Serialize(CambistaDefaults, new JsonSerializerOptions { WriteIndented = true }));
                    }

                    var time = File.GetLastWriteTimeUtc(CambistaFilePath);
                    if (time != cambistaFileTime
                        && JsonSerializer.Deserialize<CambistaRule>(File.ReadAllText(CambistaFilePath)) is { } rule
                        && rule.ZenPerWcoinP > 0)
                    {
                        cambistaRule = rule;
                        cambistaFileTime = time;
                    }
                }
                catch (Exception)
                {
                    // A broken file leaves the rule of before, cero drama.
                }
            }

            return cambistaRule;
        }
    }

    /// <summary>The points of a monster, from data/puntos.json (read again when it changed).</summary>
    private static int PointsFor(short monsterNumber)
    {
        lock (TableLock)
        {
            var now = DateTime.UtcNow;
            if (now - checkedAt > ReloadEvery)
            {
                checkedAt = now;
                Reload();
            }

            return table.TryGetValue(monsterNumber.ToString(), out var points) ? points : 0;
        }
    }

    private static void Reload()
    {
        try
        {
            if (!File.Exists(FilePath))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
                File.WriteAllText(FilePath, JsonSerializer.Serialize(Defaults, new JsonSerializerOptions { WriteIndented = true }));
            }

            var time = File.GetLastWriteTimeUtc(FilePath);
            if (time == fileTime)
            {
                return;
            }

            var read = JsonSerializer.Deserialize<Dictionary<string, int>>(File.ReadAllText(FilePath));
            if (read is not null)
            {
                table = read;
                fileTime = time;
            }
        }
        catch (Exception)
        {
            // A broken file keeps the last good table.
        }
    }

    /// <summary>One WCoinP costs ZenPerWcoinP zen; the max changed in one click and the daily limit of one account.</summary>
    private sealed record CambistaRule(int ZenPerWcoinP, int MaxPerClick, int DailyCap);

    /// <summary>The amounts changed of the day by one account; the day is the one of Venezuela (UTC-4).</summary>
    private sealed record CambistaState(DateOnly Day, int Got);
}

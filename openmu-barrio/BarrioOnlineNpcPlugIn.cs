// <copyright file="BarrioOnlineNpcPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.ComponentModel.DataAnnotations;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using MUnique.OpenMU.GameLogic.NPC;
using MUnique.OpenMU.GameLogic.Views.NPC;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: "Premio" NPC in Lorencia, a guard next to the Cambista, which rewards the
/// connected time: +3 points (Goblin Points) every 20 minutes online, handed out when the
/// player answers to it. Completing a streak of 3 rewards in a row adds +9 points more.
/// The time of the last reward of each account is kept in data/premio-online.json,
/// so a server restart does not hand it out again. The points are the same as the ones
/// of the golden monsters, spent in the points shop of the web (Mi cuenta).
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: premio por estar online", Description = "NPC Premio en Lorencia: +3 puntos cada 20 minutos online (racha de 3 premios seguidos trae +9 extra).")]
[Guid("6B1E6F3C-2D4A-4F0B-9C7E-B4A1D0E5F205")]
public class BarrioOnlineNpcPlugIn : IObjectAddedToMapPlugIn, IPlayerTalkToNpcPlugIn
{
    private const short PremioNpcNumber = 249;

    private const short LorenciaMapNumber = 0;

    /// <summary>The NPC appears next to the Cambista (142, 124), near the south-east exit of Lorencia.</summary>
    private const byte PremioX = 142;

    private const byte PremioY = 128;

    /// <summary>The connected time which has to pass for the next reward.</summary>
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(20);

    /// <summary>The points given each time.</summary>
    private const int PointsPerReward = 3;

    /// <summary>The rewards of a streak; when it is completed, the bonus is added and the streak starts again.</summary>
    private const int StreakLength = 3;

    private const int StreakBonus = 9;

    private static readonly BarrioStore<OnlineState> Store = new("premio-online");

    /// <summary>The NPCs spawned by this plugin.</summary>
    private static readonly ConditionalWeakTable<NonPlayerCharacter, object> OwnNpcs = new();

    /// <summary>The maps where the NPC was already spawned.</summary>
    private static readonly ConditionalWeakTable<GameMap, object> SpawnedMaps = new();

    private static readonly SemaphoreSlim SpawnLock = new(1, 1);

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
            var definition = player.GameContext.Configuration.Monsters.FirstOrDefault(m => m.Number == PremioNpcNumber);
            if (definition is null)
            {
                return;
            }

            var area = new MonsterSpawnArea
            {
                GameMap = map.Definition,
                MonsterDefinition = definition,
                X1 = (byte)(PremioX - 1),
                Y1 = (byte)(PremioY - 1),
                X2 = (byte)(PremioX + 1),
                Y2 = (byte)(PremioY + 1),
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
        var login = account.LoginName ?? string.Empty;
        if (string.IsNullOrEmpty(login))
        {
            return;
        }

        var now = DateTime.UtcNow;
        var state = Store.Get(login);
        var remaining = ((state?.LastAt ?? DateTime.MinValue) + Interval) - now;
        if (remaining > TimeSpan.Zero)
        {
            var wait = FormatWait(remaining);
            await player.InvokeViewPlugInAsync<IShowMessageOfObjectPlugIn>(p => p.ShowMessageOfObjectAsync($"Faltan {wait} para el proximo premio.", npc)).ConfigureAwait(false);
            await player.ShowBlueMessageAsync($"Premio por estar online: +{PointsPerReward} puntos cada {Interval.TotalMinutes} minutos. Faltan {wait} para el proximo.").ConfigureAwait(false);
            return;
        }

        var streak = (state?.Streak ?? 0) + 1;
        var extra = streak >= StreakLength ? StreakBonus : 0;
        var newStreak = streak >= StreakLength ? 0 : streak;
        if (!Store.Update(login, _ => new OnlineState(now, newStreak)))
        {
            return;
        }

        var gained = PointsPerReward + extra;
        account.GoblinPoints = (int)Math.Min((long)account.GoblinPoints + gained, int.MaxValue);
        await player.InvokeViewPlugInAsync<IShowMessageOfObjectPlugIn>(p => p.ShowMessageOfObjectAsync($"Premio: +{gained} puntos.", npc)).ConfigureAwait(false);
        await player.ShowBlueMessageAsync($"Premio por estar online: +{PointsPerReward} puntos por {Interval.TotalMinutes} minutos conectado. Tienes {account.GoblinPoints} puntos.").ConfigureAwait(false);
        if (extra > 0)
        {
            await player.ShowBlueMessageAsync($"Premio por estar online: racha de {StreakLength} premios seguidos, +{extra} puntos extra! Sigue conectado.").ConfigureAwait(false);
        }
        else
        {
            await player.ShowBlueMessageAsync($"Premio {newStreak} de {StreakLength}: al completar la racha vienen +{StreakBonus} puntos extra.").ConfigureAwait(false);
        }
    }

    private static string FormatWait(TimeSpan remaining)
    {
        var minutes = (int)Math.Ceiling(remaining.TotalMinutes);
        return minutes >= 60 ? $"{minutes / 60}h {minutes % 60}m" : $"{minutes} min";
    }

    /// <summary>The online reward state of one account.</summary>
    private sealed record OnlineState(DateTime LastAt, int Streak);
}

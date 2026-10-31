// <copyright file="BarrioDailyRewardPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using MUnique.OpenMU.GameLogic.Views.Inventory;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: gives zen once a day per account, the first time one of its
/// characters enters the world. The day of the last reward is kept in a small
/// JSON file next to the server, so a restart does not hand it out again.
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: premio diario", Description = "Da zen una vez al dia por cuenta al entrar al juego.")]
[Guid("6B1E6F3C-2D4A-4F0B-9C7E-B4A1D0E5F201")]
public class BarrioDailyRewardPlugIn : IPlayerStateChangedPlugIn
{
    /// <summary>The zen given each day.</summary>
    private const int RewardMoney = 5_000_000;

    /// <summary>The day changes at midnight in Venezuela (UTC-4).</summary>
    private static readonly TimeSpan ServerTimeOffset = TimeSpan.FromHours(-4);

    private static readonly string StorePath = Path.Combine(AppContext.BaseDirectory, "data", "premio-diario.json");

    private static readonly SemaphoreSlim StoreLock = new(1, 1);

    private static Dictionary<string, DateOnly>? lastRewards;

    /// <inheritdoc />
    public async ValueTask PlayerStateChangedAsync(Player player, State previousState, State currentState)
    {
        if (previousState != PlayerState.CharacterSelection || currentState != PlayerState.EnteredWorld)
        {
            return;
        }

        if (player.Account?.LoginName is not { Length: > 0 } login)
        {
            return;
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow + ServerTimeOffset);
        bool rewarded;
        await StoreLock.WaitAsync().ConfigureAwait(false);
        try
        {
            var rewards = lastRewards ??= Load();
            if (rewards.TryGetValue(login, out var last) && last >= today)
            {
                return;
            }

            rewarded = player.TryAddMoney(RewardMoney);
            if (rewarded)
            {
                rewards[login] = today;
                Save(rewards);
            }
        }
        finally
        {
            StoreLock.Release();
        }

        if (!rewarded)
        {
            await player.ShowBlueMessageAsync("Premio diario: no tienes espacio para mas zen. Guarda zen en el baul y vuelve a entrar.").ConfigureAwait(false);
            return;
        }

        await player.InvokeViewPlugInAsync<IUpdateMoneyPlugIn>(p => p.UpdateMoneyAsync()).ConfigureAwait(false);
        await player.ShowBlueMessageAsync($"Premio diario de BarrioMU: +{RewardMoney:N0} zen. Vuelve manana por mas.").ConfigureAwait(false);
    }

    private static Dictionary<string, DateOnly> Load()
    {
        try
        {
            if (File.Exists(StorePath)
                && JsonSerializer.Deserialize<Dictionary<string, DateOnly>>(File.ReadAllText(StorePath)) is { } stored)
            {
                return new Dictionary<string, DateOnly>(stored, StringComparer.OrdinalIgnoreCase);
            }
        }
        catch (Exception)
        {
            // A broken file only means everybody gets today's reward once more.
        }

        return new Dictionary<string, DateOnly>(StringComparer.OrdinalIgnoreCase);
    }

    private static void Save(Dictionary<string, DateOnly> rewards)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StorePath)!);
            File.WriteAllText(StorePath, JsonSerializer.Serialize(rewards));
        }
        catch (Exception)
        {
            // Not being able to write the file must never keep a player out of the game.
        }
    }
}

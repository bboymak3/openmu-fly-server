// <copyright file="BarrioMasterResetPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.Runtime.InteropServices;
using MUnique.OpenMU.GameLogic.Attributes;
using MUnique.OpenMU.GameLogic.PlayerActions;
using MUnique.OpenMU.GameLogic.PlugIns.ChatCommands;
using MUnique.OpenMU.GameLogic.Resets;
using MUnique.OpenMU.GameLogic.Views.Login;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: the Master Reset, with the chat command /masterreset.
/// With <see cref="RequiredResets"/> resets and the level of a reset, the resets
/// go back to 0, the level and the stats to the start, and the character gets
/// one more Master Reset. Every Master Reset adds <see cref="BonusPointsPerMasterReset"/>
/// points to each reset from then on (see ResetCharacterAction, master-reset.patch).
/// The count is kept in data/master-reset.json by character id; the landing reads
/// it for the ranking and the panel can do the Master Reset too.
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: master reset", Description = "Comando /masterreset: con 50 resets vuelve a 0 y da +10.000 puntos por reset para siempre.")]
[Guid("6B1E6F3C-2D4A-4F0B-9C7E-B4A1D0E5F203")]
[ChatCommandHelp(Command)]
public class BarrioMasterResetPlugIn : IChatCommandPlugIn
{
    /// <summary>The resets needed for a Master Reset.</summary>
    public const int RequiredResets = 50;

    /// <summary>The points that each Master Reset adds to every reset.</summary>
    public const int BonusPointsPerMasterReset = 10_000;

    private const string Command = "/masterreset";

    private static readonly BarrioStore<int> Store = new("master-reset");

    private readonly LogoutAction _logoutAction = new();

    /// <inheritdoc />
    public string Key => Command;

    /// <inheritdoc />
    public CharacterStatus MinCharacterStatusRequirement => CharacterStatus.Normal;

    /// <summary>
    /// Gets the Master Resets of a character.
    /// </summary>
    /// <param name="characterId">The id of the character.</param>
    /// <returns>The Master Resets.</returns>
    public static int MasterResets(Guid characterId) => Math.Max(0, Store.Get(characterId.ToString()));

    /// <summary>
    /// Gets the points that the Master Resets of a character add to each reset.
    /// </summary>
    /// <param name="characterId">The id of the character.</param>
    /// <returns>The bonus points.</returns>
    public static int BonusPoints(Guid characterId) => MasterResets(characterId) * BonusPointsPerMasterReset;

    /// <inheritdoc />
    public async ValueTask HandleCommandAsync(Player player, string command)
    {
        if (player.Attributes is not { } attributes || player.SelectedCharacter is not { } character)
        {
            return;
        }

        if (player.PlayerState.CurrentState != PlayerState.EnteredWorld)
        {
            await player.ShowBlueMessageAsync("Master Reset: cierra las ventanas abiertas y vuelve a intentar.").ConfigureAwait(false);
            return;
        }

        var configuration = player.GameContext.FeaturePlugIns.GetPlugIn<ResetFeaturePlugIn>()?.Configuration;
        var requiredLevel = configuration?.RequiredLevel ?? 400;
        var levelAfterReset = configuration?.LevelAfterReset ?? 1;
        var resets = (int)attributes[Stats.Resets];
        var masterResets = MasterResets(character.Id);

        if (resets < RequiredResets || player.Level < requiredLevel)
        {
            await player.ShowBlueMessageAsync($"Master Reset: necesitas {RequiredResets} resets y nivel {requiredLevel}. Tienes {resets} resets, nivel {player.Level} y {masterResets} Master Reset.").ConfigureAwait(false);
            return;
        }

        var next = masterResets + 1;
        if (!Store.Update(character.Id.ToString(), _ => next))
        {
            await player.ShowBlueMessageAsync("Master Reset: no se pudo guardar, intenta en un rato.").ConfigureAwait(false);
            return;
        }

        attributes[Stats.Resets] = 0;
        attributes[Stats.Level] = levelAfterReset;
        character.Experience = 0;
        foreach (var stat in character.CharacterClass!.StatAttributes.Where(s => s.IncreasableByPlayer))
        {
            attributes[stat.Attribute] = stat.BaseValue;
        }

        character.LevelUpPoints = next * BonusPointsPerMasterReset;

        var homeMapDef = character.CharacterClass.HomeMap;
        if (homeMapDef is { }
            && await player.GameContext.GetMapAsync((ushort)homeMapDef.Number).ConfigureAwait(false) is { SafeZoneSpawnGate: { } spawnGate })
        {
            character.PositionX = (byte)Rand.NextInt(spawnGate.X1, spawnGate.X2);
            character.PositionY = (byte)Rand.NextInt(spawnGate.Y1, spawnGate.Y2);
            character.CurrentMap = spawnGate.Map;
            player.Rotation = spawnGate.Direction;
        }

        await player.ShowBlueMessageAsync($"¡Master Reset {next}! Vuelves a nivel {levelAfterReset} con {character.LevelUpPoints:N0} puntos, y cada reset te dara {next * BonusPointsPerMasterReset:N0} puntos extra.").ConfigureAwait(false);
        await Task.Delay(2000).ConfigureAwait(false);
        await this._logoutAction.LogoutAsync(player, LogoutType.BackToCharacterSelection).ConfigureAwait(false);
    }
}

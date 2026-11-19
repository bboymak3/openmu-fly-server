// <copyright file="BarrioSabioProteccionPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Runtime.InteropServices;
using MUnique.OpenMU.GameLogic.Views;
using MUnique.OpenMU.Pathfinding;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: protege las mascotas del Sabio (todas las etapas) para que no se pierdan.
/// No se pueden tirar, vender, comerciar ni guardar en el baúl.
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: protección de la mascota del Sabio", Description = "Impide tirar, vender, comerciar o guardar en baúl las etapas del Sabio.")]
[Guid("F1A2B3C4-D5E6-4F70-8123-456789ABCDEF")]
public class BarrioSabioProteccionPlugIn : IItemDropPlugIn, IItemMovingPlugIn, IPlayerStateChangedPlugIn
{
    private static readonly short[] SabioNumbers = [0, 65, 80, 64];
    private static bool _definitionsLocked;

    /// <inheritdoc />
    public async ValueTask HandleItemDropAsync(Player player, Item item, Point target, IItemDropPlugIn.ItemDropArguments dropArgs)
    {
        if (!IsSabioPet(item))
        {
            return;
        }

        dropArgs.WasHandled = true;
        dropArgs.Success = false;
        await player.ShowBlueMessageAsync("No puedes soltar al Sabio. Es tu compañero.").ConfigureAwait(false);
    }

    /// <inheritdoc />
    public void ItemMoving(Player player, Item item, Storages targetStorage, int slot, CancelEventArgs eventArgs)
    {
        if (!IsSabioPet(item))
        {
            return;
        }

        if (targetStorage is Storages.Vault or Storages.Trade or Storages.PersonalStore)
        {
            eventArgs.Cancel = true;
            _ = player.ShowBlueMessageAsync("No puedes guardar ni pasar al Sabio. Debe quedarse contigo.");
        }
    }

    /// <inheritdoc />
    public ValueTask PlayerStateChangedAsync(Player player, State previousState, State currentState)
    {
        if (!_definitionsLocked && currentState == PlayerState.EnteredWorld)
        {
            LockDefinitions(player);
        }

        return ValueTask.CompletedTask;
    }

    private static void LockDefinitions(Player player)
    {
        foreach (var def in player.GameContext.Configuration.Items.Where(i => i.Group == 13 && SabioNumbers.Contains(i.Number)))
        {
            def.IsDroppable = false;
            def.IsSellableToNpc = false;
            def.IsTradable = false;
            def.IsStorable = false;
            def.IsPersonalStoreSellable = false;
        }

        _definitionsLocked = true;
    }

    private static bool IsSabioPet(Item item)
        => item.Definition is { Group: 13 } def && SabioNumbers.Contains(def.Number);
}

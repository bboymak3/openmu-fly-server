// <copyright file="BarrioGrantSabioPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.ComponentModel.DataAnnotations;
using System.Runtime.InteropServices;
using MUnique.OpenMU.DataModel;
using MUnique.OpenMU.DataModel.Entities;
using MUnique.OpenMU.GameLogic.Views;
using MUnique.OpenMU.GameLogic.Views.Inventory;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: entrega la mascota del Sabio a todos los personajes que no la tengan.
/// No reemplaza etapas ya evolucionadas para no perder progreso.
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: dar mascota del Sabio a todos los personajes", Description = "Entrega Sabio a los personajes que no tengan ninguna etapa, en su propio espacio.")]
[Guid("E6F7A8B9-C0D1-4E2F-B3A4-5C6D7E8F9012")]
public class BarrioGrantSabioPlugIn : IPlayerStateChangedPlugIn
{
    private static readonly short[] SabioNumbers = [0, 65, 80, 64];

    private static readonly BarrioStore<string> Store = new("mascotas-sabio-grant");

    /// <inheritdoc />
    public async ValueTask PlayerStateChangedAsync(Player player, State previousState, State currentState)
    {
        if (previousState != PlayerState.CharacterSelection || currentState != PlayerState.EnteredWorld
            || player.SelectedCharacter is not { } character)
        {
            return;
        }

        var key = "v4:" + (character.Id == Guid.Empty ? (player.Account?.LoginName ?? "?") + ":" + character.Name : character.Id.ToString());
        if (Store.Get(key) == "done")
        {
            // Aun así, migra si por alguna razón quedó en la ranura de mascota.
            await BarrioMascotasPlugIn.EnsureSabioInOwnSpaceAsync(player).ConfigureAwait(false);
            return;
        }

        if (player.Inventory is null)
        {
            return;
        }

        // Si ya tiene alguna etapa del Sabio (incluso evolucionada), no se toca.
        if (player.Inventory.Items.Any(IsSabioPet))
        {
            await BarrioMascotasPlugIn.EnsureSabioInOwnSpaceAsync(player).ConfigureAwait(false);
            Store.Update(key, _ => "done");
            return;
        }

        var definition = player.GameContext.Configuration.Items.FirstOrDefault(i => i.Group == 13 && i.Number == 0);
        if (definition is null)
        {
            return;
        }

        var item = player.PersistenceContext.CreateNew<Item>();
        item.Definition = definition;
        item.Durability = definition.Durability;
        item.Level = 0;

        var preferred = (byte)(InventoryConstants.LastEquippableItemSlotIndex + 1);
        var ok = player.Inventory.GetItem(preferred) is null
            ? await player.Inventory.AddItemAsync(preferred, item).ConfigureAwait(false)
            : await player.Inventory.AddItemAsync(item).ConfigureAwait(false);
        if (!ok)
        {
            player.PersistenceContext.Detach(item);
            return;
        }

        await player.InvokeViewPlugInAsync<IItemAppearPlugIn>(p => p.ItemAppearAsync(item)).ConfigureAwait(false);
        Store.Update(key, _ => "done");

        try
        {
            var msg = "Recibiste al Sabio en su espacio. Te acompaña activo y puedes llevar otra mascota en la ranura de mascota. /ia para hablar, /mascota para ver su progreso.";
            await player.InvokeViewPlugInAsync<IChatViewPlugIn>(
                p => p.ChatMessageAsync(msg, "Sabio", ChatMessageType.Whisper)).ConfigureAwait(false);
        }
        catch
        {
            // aviso opcional
        }
    }

    private static bool IsSabioPet(Item item)
        => item.Definition is { Group: 13 } def && SabioNumbers.Contains(def.Number);
}

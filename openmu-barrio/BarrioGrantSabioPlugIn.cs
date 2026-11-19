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
/// BarrioMU: entrega (o reemplaza) la mascota del Sabio a las cuentas de prueba
/// barrio01-barrio05 para validar que funciona.
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: dar mascota del Sabio a cuentas barrio01-05", Description = "Entrega Guardian Angel (Sabio) a barrio01-barrio05 al entrar al juego.")]
[Guid("E6F7A8B9-C0D1-4E2F-B3A4-5C6D7E8F9012")]
public class BarrioGrantSabioPlugIn : IPlayerStateChangedPlugIn
{
    private static readonly HashSet<string> TargetLogins = new(StringComparer.OrdinalIgnoreCase)
    {
        "barrio01", "barrio02", "barrio03", "barrio04", "barrio05",
    };

    private static readonly short[] SabioNumbers = [0, 65, 80, 64];

    private static readonly BarrioStore<string> Store = new("mascotas-sabio-grant");

    /// <inheritdoc />
    public async ValueTask PlayerStateChangedAsync(Player player, State previousState, State currentState)
    {
        if (previousState != PlayerState.CharacterSelection || currentState != PlayerState.EnteredWorld
            || player.Account?.LoginName is not { } login
            || player.SelectedCharacter is not { } character
            || !TargetLogins.Contains(login))
        {
            return;
        }

        var key = "v2:" + (character.Id == Guid.Empty ? login + ":" + character.Name : character.Id.ToString());
        if (Store.Get(key) == "done")
        {
            return;
        }

        var definition = player.GameContext.Configuration.Items.FirstOrDefault(i => i.Group == 13 && i.Number == 0);
        if (definition is null || player.Inventory is null)
        {
            return;
        }

        // Quita cualquier etapa del Sabio que ya tenga (equipada o en la bolsa).
        foreach (var old in player.Inventory.Items.Where(i => IsSabioPet(i)).ToList())
        {
            await player.DestroyInventoryItemAsync(old).ConfigureAwait(false);
        }

        var item = player.PersistenceContext.CreateNew<Item>();
        item.Definition = definition;
        item.Durability = definition.Durability;
        item.Level = 0;

        var ok = await player.Inventory.AddItemAsync(InventoryConstants.PetSlot, item).ConfigureAwait(false)
                 || await player.Inventory.AddItemAsync(item).ConfigureAwait(false);
        if (!ok)
        {
            player.PersistenceContext.Detach(item);
            return;
        }

        await player.InvokeViewPlugInAsync<IItemAppearPlugIn>(p => p.ItemAppearAsync(item)).ConfigureAwait(false);
        Store.Update(key, _ => "done");

        try
        {
            await player.InvokeViewPlugInAsync<MUnique.OpenMU.GameLogic.Views.IChatViewPlugIn>(
                p => p.ChatMessageAsync("Te dejé al Sabio (mascota) en tu inventario. Si no está puesta, equípala en la ranura de mascota.", "Sabio", ChatMessageType.Whisper)).ConfigureAwait(false);
        }
        catch
        {
            // aviso opcional
        }
    }

    private static bool IsSabioPet(Item item)
        => item.Definition is { Group: 13 } def && SabioNumbers.Contains(def.Number);
}

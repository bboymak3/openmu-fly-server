// <copyright file="BarrioSabioShopPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.ComponentModel.DataAnnotations;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using MUnique.OpenMU.DataModel;
using MUnique.OpenMU.DataModel.Entities;
using MUnique.OpenMU.GameLogic.NPC;
using MUnique.OpenMU.Pathfinding;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: pone la mascota del Sabio (Guardian Angel, 13,0) a la venta en las
/// tiendas de Lorencia (Amy y Lumen), para que se pueda comprar sin depender del NPC Sabio.
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: mascota del Sabio en la tienda de Lorencia", Description = "Agrega Guardian Angel (Sabio) a las tiendas de Amy y Lumen en Lorencia.")]
[Guid("D5E6F7A8-B9C0-4D1E-A2F3-4B5C6D7E8F90")]
public class BarrioSabioShopPlugIn : IObjectAddedToMapPlugIn
{
    private const short Lorencia = 0;
    private const short Amy = 253;
    private const short Lumen = 255;

    private static readonly (short Npc, byte X, byte Y)[] Shops =
    [
        (Amy, 127, 86),
        (Lumen, 123, 135),
    ];

    private static readonly ConditionalWeakTable<GameMap, object> Done = new();
    private static readonly SemaphoreSlim Lock = new(1, 1);

    /// <inheritdoc />
    public async ValueTask ObjectAddedToMapAsync(GameMap map, ILocateable addedObject)
    {
        if (addedObject is not Player player || map.Definition.Number != Lorencia || Done.TryGetValue(map, out _))
        {
            return;
        }

        await Lock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (Done.TryGetValue(map, out _))
            {
                return;
            }

            Done.Add(map, new object());
            var definition = player.GameContext.Configuration.Items.FirstOrDefault(i => i.Group == 13 && i.Number == 0);
            if (definition is null)
            {
                return;
            }

            foreach (var shop in Shops)
            {
                var merchant = map.GetNpcsInRange(new Point(shop.X, shop.Y), 4)
                    .OfType<MerchantNpc>()
                    .FirstOrDefault(n => n.Definition.Number == shop.Npc);
                if (merchant is null)
                {
                    continue;
                }

                if (merchant.MerchantStorage.Items.Any(i => i.Definition?.Group == 13 && i.Definition?.Number == 0))
                {
                    continue;
                }

                var item = player.PersistenceContext.CreateNew<Item>();
                item.Definition = definition;
                item.Durability = definition.Durability;
                item.Level = 0;

                var slot = merchant.MerchantStorage.CheckInvSpace(item);
                if (slot is null)
                {
                    player.PersistenceContext.Detach(item);
                    continue;
                }

                if (!await merchant.MerchantStorage.AddItemAsync(slot.Value, item).ConfigureAwait(false))
                {
                    player.PersistenceContext.Detach(item);
                }
            }
        }
        finally
        {
            Lock.Release();
        }
    }
}

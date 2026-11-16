// <copyright file="BarrioStarterSetPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.Runtime.InteropServices;
using MUnique.OpenMU.Persistence;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: every new character gets the most basic set of its class, +0, in the bag
/// (not worn: even these ask for a little more strength than a new character has),
/// plus its basic wings, already worn.
/// Dark Wizard: Pad, wings of heaven. Dark Knight: Leather, wings of satan.
/// Fairy Elf: Vine, wings of elf. Magic Gladiator: Leather without helm, wings of heaven.
/// Dark Lord: Leather, cape of the lord. Summoner: Mistery, wings of curse.
/// Rage Fighter: Leather without gloves, cape of the fighter.
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: set gratis al crear personaje", Description = "Pone en la bolsa el set mas basico de su clase y le pone puestas las alas basicas a cada personaje nuevo.")]
[Guid("8C1D2E4F-5A6B-4C7D-9E8F-0A1B2C3D4E61")]
public class BarrioStarterSetPlugIn : ICharacterCreatedPlugIn
{
    private const byte Helm = 7;
    private const byte Armor = 8;
    private const byte Pants = 9;
    private const byte Gloves = 10;
    private const byte Boots = 11;

    /// <summary>Where the wings go: the back, the same slot wings and capes use.</summary>
    private const byte WingSlot = 7;

    /// <summary>
    /// Where each piece goes in the bag (12 + row * 8 + column), from row 2 on,
    /// so the starting rings (slots 12 and 13) stay where they are.
    /// Helm rows 2-3 col 0-1, armor rows 2-4 col 2-3, pants col 4-5, gloves col 6-7, boots rows 4-5 col 0-1.
    /// </summary>
    private static readonly Dictionary<byte, byte> BagSlot = new()
    {
        [Helm] = 28,
        [Armor] = 30,
        [Pants] = 32,
        [Gloves] = 34,
        [Boots] = 44,
    };

    /// <summary>The set of each first class, and which pieces it can wear.</summary>
    private static readonly Dictionary<byte, (byte Set, byte[] Pieces)> Sets = new()
    {
        [0] = (2, [Helm, Armor, Pants, Gloves, Boots]), // Dark Wizard: Pad
        [4] = (5, [Helm, Armor, Pants, Gloves, Boots]), // Dark Knight: Leather
        [8] = (10, [Helm, Armor, Pants, Gloves, Boots]), // Fairy Elf: Vine
        [12] = (5, [Armor, Pants, Gloves, Boots]), // Magic Gladiator: Leather, no helm
        [16] = (5, [Helm, Armor, Pants, Gloves, Boots]), // Dark Lord: Leather
        [20] = (39, [Helm, Armor, Pants, Gloves, Boots]), // Summoner: Mistery
        [24] = (5, [Helm, Armor, Pants, Boots]), // Rage Fighter: Leather, no gloves
    };

    /// <summary>
    /// The basic wings of each first class. They go on the back (slot 7), the same
    /// place wings and capes use; the level they ask for does not stop them from
    /// being worn from the start, only from being taken off and put on again.
    /// </summary>
    private static readonly Dictionary<byte, (byte Group, byte Number)> Wings = new()
    {
        [0] = (12, 1), // Dark Wizard: Wings of Heaven
        [4] = (12, 2), // Dark Knight: Wings of Satan
        [8] = (12, 0), // Fairy Elf: Wings of Elf
        [12] = (12, 1), // Magic Gladiator: Wings of Heaven
        [16] = (13, 30), // Dark Lord: Cape of the Lord
        [20] = (12, 41), // Summoner: Wings of Curse
        [24] = (12, 49), // Rage Fighter: Cape of the Fighter
    };

    /// <inheritdoc />
    public void CharacterCreated(Account account, Character createdCharacter, IContext persistenceContext, GameConfiguration gameConfiguration, ILogger logger)
    {
        if (createdCharacter.CharacterClass is not { } characterClass
            || createdCharacter.Inventory is not { } inventory)
        {
            return;
        }

        if (Sets.TryGetValue(characterClass.Number, out var set))
        {
            foreach (var group in set.Pieces)
            {
                var slot = BagSlot[group];
                if (inventory.Items.Any(i => i.ItemSlot == slot))
                {
                    continue;
                }

                Give(persistenceContext, gameConfiguration, logger, inventory.Items, group, set.Set, slot);
            }
        }

        if (Wings.TryGetValue(characterClass.Number, out var wing)
            && !inventory.Items.Any(i => i.ItemSlot == WingSlot))
        {
            Give(persistenceContext, gameConfiguration, logger, inventory.Items, wing.Group, wing.Number, WingSlot);
        }
    }

    /// <summary>Adds one item, +0 and with full durability, to the given slot.</summary>
    private static void Give(IContext persistenceContext, GameConfiguration gameConfiguration, ILogger logger, ICollection<Item> items, byte group, byte number, byte slot)
    {
        var definition = gameConfiguration.Items.FirstOrDefault(d => d.Group == group && d.Number == number);
        if (definition is null)
        {
            logger.LogWarning("BarrioMU: no existe el item {group}/{number} del equipo inicial.", group, number);
            return;
        }

        var item = persistenceContext.CreateNew<Item>();
        item.Definition = definition;
        item.Durability = definition.Durability;
        item.ItemSlot = slot;
        item.Level = 0;
        items.Add(item);
    }
}

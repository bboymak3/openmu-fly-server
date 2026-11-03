// <copyright file="BarrioTownNpcsPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using MUnique.OpenMU.GameLogic.NPC;
using MUnique.OpenMU.Pathfinding;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: makes sure the NPCs of the towns are there (shops, vault, quests...).
/// When the first player enters Lorencia, Devias, Noria or Elbeland, it checks
/// every NPC that OpenMU's Season 6 data puts in that town; one that is not on
/// the map (its spawn was deleted or turned off in the configuration) is created
/// at its usual place. NPCs that are there are left alone, so this never doubles them.
/// Guards are not created here: they are monsters with their own intelligence.
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: NPCs de las ciudades", Description = "Crea las tiendas, el baul y los demas NPCs de Lorencia, Devias, Noria y Elbeland si faltan.")]
[Guid("6B1E6F3C-2D4A-4F0B-9C7E-B4A1D0E5F204")]
public class BarrioTownNpcsPlugIn : IObjectAddedToMapPlugIn
{
    /// <summary>How close the NPC must be to its usual place to count as "there".</summary>
    private const int Range = 4;

    /// <summary>The NPCs of the towns, from OpenMU's initialization (Version075 → 095d → Season 6 maps).</summary>
    private static readonly TownNpc[] Expected =
    [
        // Lorencia
        new(0, 240, 146, 110, Direction.SouthEast),
        new(0, 240, 147, 145, Direction.SouthWest),
        new(0, 249, 131, 88, Direction.SouthWest),
        new(0, 249, 173, 125, Direction.SouthEast),
        new(0, 249, 94, 125, Direction.NorthWest),
        new(0, 249, 94, 130, Direction.NorthWest),
        new(0, 249, 131, 148, Direction.SouthWest),
        new(0, 247, 114, 125, Direction.SouthEast),
        new(0, 251, 116, 141, Direction.SouthEast),
        new(0, 253, 127, 86, Direction.South),
        new(0, 254, 118, 113, Direction.SouthEast),
        new(0, 255, 123, 135, Direction.SouthWest),
        new(0, 236, 175, 120, Direction.SouthEast),
        new(0, 230, 62, 130, Direction.SouthEast),
        new(0, 226, 122, 110, Direction.SouthEast),
        new(0, 257, 96, 129, Direction.SouthWest),
        new(0, 257, 174, 129, Direction.SouthWest),
        new(0, 257, 130, 128, Direction.SouthEast),
        new(0, 257, 132, 165, Direction.SouthEast),
        new(0, 375, 132, 161, Direction.SouthEast),
        new(0, 543, 141, 143, Direction.South),
        new(0, 371, 130, 126, Direction.SouthEast),
        new(0, 547, 139, 138, Direction.SouthEast),
        // Devias
        new(2, 244, 226, 25, Direction.SouthEast),
        new(2, 245, 225, 41, Direction.SouthEast),
        new(2, 246, 186, 47, Direction.SouthEast),
        new(2, 247, 224, 79, Direction.NorthEast),
        new(2, 247, 219, 79, Direction.NorthEast),
        new(2, 247, 169, 45, Direction.NorthWest),
        new(2, 247, 169, 39, Direction.NorthWest),
        new(2, 241, 215, 45, Direction.SouthWest),
        new(2, 240, 218, 63, Direction.South),
        new(2, 235, 183, 32, Direction.SouthEast),
        new(2, 540, 233, 66, Direction.SouthWest),
        new(2, 406, 181, 35, Direction.SouthEast),
        new(2, 385, 197, 53, Direction.SouthWest),
        new(2, 478, 191, 17, Direction.SouthEast),
        new(2, 256, 193, 13, Direction.SouthEast),
        new(2, 522, 229, 221, Direction.SouthWest),
        new(2, 257, 219, 76, Direction.SouthEast),
        new(2, 566, 204, 61, Direction.SouthEast),
        new(2, 379, 13, 28, Direction.SouthEast),
        new(2, 233, 217, 29, Direction.SouthEast),
        new(2, 233, 217, 20, Direction.SouthEast),
        // Noria
        new(3, 253, 169, 109, Direction.SouthEast),
        new(3, 253, 193, 110, Direction.South),
        new(3, 242, 173, 125, Direction.SouthWest),
        new(3, 243, 195, 124, Direction.South),
        new(3, 240, 172, 96, Direction.SouthEast),
        new(3, 238, 180, 103, Direction.SouthWest),
        new(3, 237, 171, 105, Direction.SouthEast),
        new(3, 544, 187, 125, Direction.SouthWest),
        new(3, 257, 167, 118, Direction.SouthWest),
        new(3, 450, 179, 126, Direction.SouthWest),
        new(3, 451, 179, 129, Direction.SouthEast),
        // Elvenland
        new(51, 256, 37, 242, Direction.SouthWest),
        new(51, 415, 44, 229, Direction.SouthWest),
        new(51, 416, 29, 237, Direction.South),
        new(51, 417, 37, 218, Direction.SouthWest),
        new(51, 257, 44, 189, Direction.SouthEast),
        new(51, 257, 57, 231, Direction.SouthWest),
        new(51, 240, 51, 229, Direction.SouthWest),
        new(51, 385, 55, 243, Direction.SouthWest),
        new(51, 452, 45, 243, Direction.SouthWest),
        new(51, 453, 49, 243, Direction.SouthWest),
        new(51, 540, 49, 216, Direction.South),
        new(51, 492, 22, 225, Direction.South),
        new(51, 579, 20, 214, Direction.SouthEast),
    ];

    private static readonly HashSet<short> TownMaps = Expected.Select(n => n.Map).ToHashSet();

    private static readonly ConditionalWeakTable<GameMap, object> CheckedMaps = new();

    private static readonly SemaphoreSlim CheckLock = new(1, 1);

    /// <inheritdoc />
    public async ValueTask ObjectAddedToMapAsync(GameMap map, ILocateable addedObject)
    {
        if (addedObject is not Player player || !TownMaps.Contains(map.Definition.Number) || CheckedMaps.TryGetValue(map, out _))
        {
            return;
        }

        await CheckLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (CheckedMaps.TryGetValue(map, out _))
            {
                return;
            }

            CheckedMaps.Add(map, new object());
            var logger = player.GameContext.LoggerFactory.CreateLogger<BarrioTownNpcsPlugIn>();
            var monsters = player.GameContext.Configuration.Monsters;
            var created = 0;
            foreach (var expected in Expected.Where(n => n.Map == map.Definition.Number))
            {
                if (await EnsureAsync(map, monsters, expected, logger).ConfigureAwait(false))
                {
                    created++;
                }
            }

            if (created > 0)
            {
                logger.LogWarning("BarrioMU: {count} NPCs faltaban en {map} y se crearon.", created, map.Definition.Name);
            }
        }
        finally
        {
            CheckLock.Release();
        }
    }

    private static async ValueTask<bool> EnsureAsync(GameMap map, ICollection<MonsterDefinition> monsters, TownNpc expected, ILogger logger)
    {
        var definition = monsters.FirstOrDefault(m => m.Number == expected.Npc);
        if (definition is null || definition.ObjectKind != NpcObjectKind.PassiveNpc)
        {
            return false;
        }

        if (map.GetNpcsInRange(new Point(expected.X, expected.Y), Range).Any(n => n.Definition.Number == expected.Npc))
        {
            return false;
        }

        var area = new MonsterSpawnArea
        {
            GameMap = map.Definition,
            MonsterDefinition = definition,
            X1 = expected.X,
            Y1 = expected.Y,
            X2 = expected.X,
            Y2 = expected.Y,
            Quantity = 1,
            Direction = expected.Direction,
        };

        NonPlayerCharacter npc = definition.MerchantStore is not null
            ? new MerchantNpc(area, definition, map)
            : new NonPlayerCharacter(area, definition, map);
        try
        {
            npc.Initialize();
            await map.AddAsync(npc).ConfigureAwait(false);
            npc.OnSpawn();
            logger.LogInformation("BarrioMU: NPC {number} ({name}) creado en {map} {x},{y}.", expected.Npc, definition.Designation, map.Definition.Name, expected.X, expected.Y);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "BarrioMU: no se pudo crear el NPC {number} en {map}.", expected.Npc, map.Definition.Name);
            await npc.DisposeAsync().ConfigureAwait(false);
            return false;
        }
    }

    private readonly record struct TownNpc(short Map, short Npc, byte X, byte Y, Direction Direction);
}

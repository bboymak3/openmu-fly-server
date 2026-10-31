// <copyright file="BarrioBuffNpcsPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using MUnique.OpenMU.AttributeSystem;
using MUnique.OpenMU.DataModel.Attributes;
using MUnique.OpenMU.GameLogic.Attributes;
using MUnique.OpenMU.GameLogic.NPC;
using MUnique.OpenMU.GameLogic.Views.Character;
using MUnique.OpenMU.GameLogic.Views.NPC;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: two NPCs in Lorencia, next to the spawn, which give buffs.
/// "Guerrero" (David, 579; Jerint 522 has a monster model and the web client never talks to it): +20% attack and +20% magic for 30 minutes, free, any time.
/// "Fortuna" (Delgado, 478): double experience and double drop for 45 minutes, once every 3 hours.
/// The buffs show up in the buff bar of the client with their remaining time
/// (Scroll of Wrath, Scroll of Wizardry and Seal of Wealth). They stack with every other buff.
/// What is left of a buff is kept in data/buffs-npc.json, so it comes back after
/// a disconnect or a server restart.
/// </summary>
[PlugIn]
[Display(Name = "BarrioMU: NPCs de buff", Description = "Guerrero (+20% ataque y magia, 30 min) y Fortuna (doble EXP y drop, 45 min cada 3 horas) en Lorencia.")]
[Guid("6B1E6F3C-2D4A-4F0B-9C7E-B4A1D0E5F202")]
public class BarrioBuffNpcsPlugIn : IObjectAddedToMapPlugIn, IPlayerTalkToNpcPlugIn, IPlayerStateChangedPlugIn, IExperienceCalculationPlugIn
{
    /// <summary>The effect of Fortuna (eBuff_SealOfWealth of the client). The drop generator doubles the drops while it is active.</summary>
    public const short FortunaEffectNumber = 41;

    /// <summary>The attack effect of Guerrero (eBuff_ScrollOfWrath of the client).</summary>
    private const short AttackEffectNumber = 46;

    /// <summary>The magic effect of Guerrero (eBuff_ScrollOfWizardry of the client).</summary>
    private const short MagicEffectNumber = 47;

    private const short GuerreroNpcNumber = 579;

    private const short FortunaNpcNumber = 478;

    private const short LorenciaMapNumber = 0;

    private const float DamageBonus = 0.2f;

    private static readonly TimeSpan GuerreroDuration = TimeSpan.FromMinutes(30);

    private static readonly TimeSpan FortunaDuration = TimeSpan.FromMinutes(45);

    private static readonly TimeSpan FortunaCooldown = TimeSpan.FromHours(3);

    private static readonly MagicEffectDefinition AttackDefinition = new BarrioEffectDefinition(AttackEffectNumber, "Guerrero: ataque");

    private static readonly MagicEffectDefinition MagicDefinition = new BarrioEffectDefinition(MagicEffectNumber, "Guerrero: magia");

    private static readonly MagicEffectDefinition FortunaDefinition = new BarrioEffectDefinition(FortunaEffectNumber, "Fortuna");

    private static readonly BarrioStore<BuffState> Store = new("buffs-npc");

    /// <summary>The NPCs spawned by this plugin, with their kind.</summary>
    private static readonly ConditionalWeakTable<NonPlayerCharacter, string> OwnNpcs = new();

    /// <summary>The maps where the NPCs were already spawned.</summary>
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
            var monsters = player.GameContext.Configuration.Monsters;
            await SpawnAsync(map, monsters, GuerreroNpcNumber, "guerrero", 138, 119).ConfigureAwait(false);
            await SpawnAsync(map, monsters, FortunaNpcNumber, "fortuna", 146, 119).ConfigureAwait(false);
        }
        finally
        {
            SpawnLock.Release();
        }
    }

    /// <inheritdoc />
    public async ValueTask PlayerTalksToNpcAsync(Player player, NonPlayerCharacter npc, NpcTalkEventArgs eventArgs)
    {
        if (!OwnNpcs.TryGetValue(npc, out var kind) || player.SelectedCharacter is not { } character)
        {
            return;
        }

        eventArgs.HasBeenHandled = true;
        var now = DateTime.UtcNow;
        var key = character.Id.ToString();

        if (kind == "guerrero")
        {
            await ApplyGuerreroAsync(player, GuerreroDuration).ConfigureAwait(false);
            Store.Update(key, s => (s ?? new BuffState()) with { GuerreroUntil = now + GuerreroDuration });
            await SayAsync(player, npc, "¡Que la fuerza te acompañe, guerrero!").ConfigureAwait(false);
            await player.ShowBlueMessageAsync("Buff del Guerrero: +20% de ataque y +20% de magia por 30 minutos.").ConfigureAwait(false);
            await ShowGlowAsync(player).ConfigureAwait(false);
            return;
        }

        var state = Store.Get(key);
        if (state?.FortunaNextAt is { } nextAt && nextAt > now)
        {
            var wait = nextAt - now;
            await SayAsync(player, npc, $"La suerte necesita descanso. Vuelve en {FormatWait(wait)}.").ConfigureAwait(false);
            return;
        }

        await ApplyFortunaAsync(player, FortunaDuration).ConfigureAwait(false);
        Store.Update(key, s => (s ?? new BuffState()) with { FortunaUntil = now + FortunaDuration, FortunaNextAt = now + FortunaCooldown });
        var drop = IsDoubleDropServer(player) ? "drop x4" : "doble drop";
        await SayAsync(player, npc, "¡La fortuna esta de tu lado!").ConfigureAwait(false);
        await player.ShowBlueMessageAsync($"Buff de Fortuna: doble EXP y {drop} por 45 minutos. Vuelve en 3 horas por otro.").ConfigureAwait(false);
        await ShowGlowAsync(player).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async ValueTask PlayerStateChangedAsync(Player player, State previousState, State currentState)
    {
        if (previousState != PlayerState.CharacterSelection || currentState != PlayerState.EnteredWorld
            || player.SelectedCharacter is not { } character
            || Store.Get(character.Id.ToString()) is not { } state)
        {
            return;
        }

        // What was left of the buffs when the character left the game.
        var now = DateTime.UtcNow;
        if (state.GuerreroUntil is { } guerreroUntil && guerreroUntil - now > TimeSpan.FromSeconds(5))
        {
            await ApplyGuerreroAsync(player, guerreroUntil - now).ConfigureAwait(false);
        }

        if (state.FortunaUntil is { } fortunaUntil && fortunaUntil - now > TimeSpan.FromSeconds(5))
        {
            await ApplyFortunaAsync(player, fortunaUntil - now).ConfigureAwait(false);
        }
    }

    /// <inheritdoc />
    public ValueTask CalculateExperienceAsync(Player player, ExperienceCalculationArgs args)
    {
        if (player.MagicEffectList.ContainsEffect(FortunaEffectNumber))
        {
            args.Experience *= 2;
        }

        return ValueTask.CompletedTask;
    }

    private static async ValueTask SpawnAsync(GameMap map, ICollection<MonsterDefinition> monsters, short npcNumber, string kind, byte x, byte y)
    {
        var definition = monsters.FirstOrDefault(m => m.Number == npcNumber);
        if (definition is null)
        {
            return;
        }

        var area = new MonsterSpawnArea
        {
            GameMap = map.Definition,
            MonsterDefinition = definition,
            X1 = (byte)(x - 1),
            Y1 = (byte)(y - 1),
            X2 = (byte)(x + 1),
            Y2 = (byte)(y + 1),
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
            // No walkable point there: no NPC, but the game goes on.
            await npc.DisposeAsync().ConfigureAwait(false);
            return;
        }

        OwnNpcs.AddOrUpdate(npc, kind);
        await map.AddAsync(npc).ConfigureAwait(false);
        npc.OnSpawn();
    }

    private static async ValueTask ApplyGuerreroAsync(Player player, TimeSpan duration)
    {
        if (player.Attributes is not { } attributes)
        {
            return;
        }

        await AddEffectAsync(player, AttackDefinition, duration, (Stats.AttackDamageIncrease, DamageBonus)).ConfigureAwait(false);

        // Only the classes that do magic or curse damage have these multipliers (1 = no bonus).
        var magic = new List<(AttributeDefinition, float)>();
        if (attributes[Stats.WizardryAttackDamageIncrease] > 0)
        {
            magic.Add((Stats.WizardryAttackDamageIncrease, DamageBonus));
        }

        if (attributes[Stats.CurseAttackDamageIncrease] > 0)
        {
            magic.Add((Stats.CurseAttackDamageIncrease, DamageBonus));
        }

        await AddEffectAsync(player, MagicDefinition, duration, magic.ToArray()).ConfigureAwait(false);
    }

    private static ValueTask ApplyFortunaAsync(Player player, TimeSpan duration)
    {
        // The experience (CalculateExperienceAsync) and the drop (DefaultDropGenerator) look for the effect itself.
        return AddEffectAsync(player, FortunaDefinition, duration);
    }

    private static async ValueTask AddEffectAsync(Player player, MagicEffectDefinition definition, TimeSpan duration, params (AttributeDefinition Target, float Value)[] powerUps)
    {
        // A fresh effect instead of an update, so the client gets the new remaining time.
        if (player.MagicEffectList.TryGetEffect(definition.Number, out var old))
        {
            await old.DisposeAsync().ConfigureAwait(false);
        }

        var elements = powerUps
            .Select(p => new MagicEffect.ElementWithTarget(new ConstantElement(p.Value), p.Target))
            .ToArray();
        await player.MagicEffectList.AddEffectAsync(new MagicEffect(duration, definition, elements)).ConfigureAwait(false);
    }

    private static ValueTask SayAsync(Player player, NonPlayerCharacter npc, string message)
    {
        return player.InvokeViewPlugInAsync<IShowMessageOfObjectPlugIn>(p => p.ShowMessageOfObjectAsync(message, npc));
    }

    private static ValueTask ShowGlowAsync(Player player)
    {
        return player.ForEachWorldObserverAsync<IShowEffectPlugIn>(p => p.ShowEffectAsync(player, IShowEffectPlugIn.EffectType.LevelUp), true);
    }

    private static bool IsDoubleDropServer(Player player)
    {
        // ALTOBARINAS (server 1) already has double drop (doble-drop.patch).
        return player.GameContext is IGameServerContext { Id: 1 };
    }

    private static string FormatWait(TimeSpan wait)
    {
        var minutes = (int)Math.Ceiling(wait.TotalMinutes);
        return minutes >= 60 ? $"{minutes / 60} h {minutes % 60} min" : $"{minutes} min";
    }

    /// <summary>
    /// What is kept of the buffs of a character.
    /// </summary>
    public sealed record BuffState
    {
        /// <summary>Gets the end of the buff of Guerrero.</summary>
        public DateTime? GuerreroUntil { get; init; }

        /// <summary>Gets the end of the buff of Fortuna.</summary>
        public DateTime? FortunaUntil { get; init; }

        /// <summary>Gets the time when Fortuna gives the buff again.</summary>
        public DateTime? FortunaNextAt { get; init; }
    }

    /// <summary>
    /// A magic effect which is only known to this plugin, not saved in the configuration.
    /// </summary>
    private sealed class BarrioEffectDefinition : MagicEffectDefinition
    {
        public BarrioEffectDefinition(short number, string name)
        {
            this.Number = number;
            this.Name = name;
            this.SendDuration = true;
            this.StopByDeath = false;
            this.InformObservers = false;

            // Only read by the client view: a target in its list makes it send the
            // effect with its remaining time (EffectItemConsumption), like a consumed item.
            this.PowerUpDefinitions = new List<PowerUpDefinition> { new() { TargetAttribute = Stats.BaseDamageBonus } };
            this.PowerUpDefinitionsPvp = new List<PowerUpDefinition>();
        }
    }
}

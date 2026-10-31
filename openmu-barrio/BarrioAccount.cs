// <copyright file="BarrioAccount.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.Persistence.Initialization.VersionSeasonSix.TestAccounts;

using MUnique.OpenMU.DataModel.Configuration;
using MUnique.OpenMU.DataModel.Entities;
using MUnique.OpenMU.Persistence.Initialization.CharacterClasses;

/// <summary>
/// BarrioMU: una cuenta con un solo personaje de tercera clase, nivel 400,
/// con el set +15 y las alas de tercera de <see cref="Level400"/>.
/// </summary>
internal class BarrioAccount : Level400
{
    private readonly string _characterName;

    /// <summary>
    /// 0 = Blade Master, 1 = Grand Master, 2 = High Elf, 3 = Lord Emperor, 4 = Duel Master.
    /// </summary>
    private readonly int _characterKind;

    /// <summary>
    /// Initializes a new instance of the <see cref="BarrioAccount"/> class.
    /// </summary>
    /// <param name="context">The context.</param>
    /// <param name="gameConfiguration">The game configuration.</param>
    /// <param name="accountName">Name of the account, also its password.</param>
    /// <param name="characterName">Name of its only character.</param>
    /// <param name="characterKind">Which class the character is.</param>
    public BarrioAccount(IContext context, GameConfiguration gameConfiguration, string accountName, string characterName, int characterKind)
        : base(context, gameConfiguration, accountName, 400)
    {
        this._characterName = characterName;
        this._characterKind = characterKind;
    }

    /// <inheritdoc/>
    protected override Character CreateKnight() => this._characterKind == 0 ? base.CreateKnight() : null!;

    /// <inheritdoc/>
    protected override Character CreateWizard() => this._characterKind == 1 ? base.CreateWizard() : null!;

    /// <inheritdoc/>
    protected override Character CreateElf() => this._characterKind == 2 ? base.CreateElf() : null!;

    /// <inheritdoc/>
    protected override Character CreateDarkLord() => this._characterKind == 3 ? base.CreateDarkLord() : null!;

    /// <inheritdoc/>
    protected override Character CreateMagicGladiator() => this._characterKind == 4 ? base.CreateMagicGladiator() : null!;

    /// <inheritdoc/>
    protected override Character CreateCharacter(string name, CharacterClassNumber characterClass, int level, byte slot)
        => base.CreateCharacter(this._characterName, characterClass, level, 0);
}

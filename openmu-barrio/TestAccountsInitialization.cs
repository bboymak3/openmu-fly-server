// <copyright file="TestAccountsInitialization.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.Persistence.Initialization.VersionSeasonSix.TestAccounts;

using MUnique.OpenMU.DataModel.Configuration;

/// <summary>
/// BarrioMU: reemplaza las cuentas de prueba de OpenMU por barrio01 a barrio10
/// (clave igual al usuario), cada una con un solo personaje full.
/// </summary>
public class TestAccountsInitialization : InitializerBase
{
    /// <summary>
    /// Initializes a new instance of the <see cref="TestAccountsInitialization"/> class.
    /// </summary>
    /// <param name="context">The context.</param>
    /// <param name="gameConfiguration">The game configuration.</param>
    public TestAccountsInitialization(IContext context, GameConfiguration gameConfiguration)
        : base(context, gameConfiguration)
    {
    }

    /// <inheritdoc />
    public override void Initialize()
    {
        for (int i = 1; i <= 10; i++)
        {
            var number = i.ToString("00");
            new BarrioAccount(this.Context, this.GameConfiguration, "barrio" + number, "Barrio" + number, (i - 1) % 5).Initialize();
        }
    }
}

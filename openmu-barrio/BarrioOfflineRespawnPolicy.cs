// <copyright file="BarrioOfflineRespawnPolicy.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.Offline;

/// <summary>
/// BarrioMU: decide si un personaje que farmea sin conexion (/offlevel) sigue farmeando despues
/// de morir y revivir. En OpenMU la sesion se termina al morir; build-arm64.yml cambia
/// <c>OfflinePlayer.RespawnAndContinue</c> para que pregunte aqui. Lo usan los spots de farmeo
/// (BarrioSpotsPlugIn): quien esta en un spot sigue, y BarrioMU lo devuelve al spot.
/// </summary>
public static class OfflineRespawnPolicy
{
    /// <summary>Si es null, o devuelve false, la sesion se termina al morir (lo normal de OpenMU).</summary>
    public static Func<OfflinePlayer, bool>? ShouldContinue { get; set; }
}

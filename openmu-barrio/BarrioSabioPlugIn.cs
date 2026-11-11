// <copyright file="BarrioSabioPlugIn.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.ComponentModel.DataAnnotations;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json.Serialization;
using MUnique.OpenMU.GameLogic.Attributes;
using MUnique.OpenMU.GameLogic.PlugIns.ChatCommands;
using MUnique.OpenMU.GameLogic.Views;
using MUnique.OpenMU.PlugIns;

/// <summary>
/// BarrioMU: "El Sabio del Barrio", la IA del juego. El jugador escribe <c>/ia pregunta</c>
/// y la respuesta le llega como susurro del Sabio.
/// </summary>
/// <remarks>
/// El servidor de juego no habla con la IA: le pasa la pregunta y los datos reales del
/// personaje (que salen del servidor, no de lo que escriba el jugador) a la API de BarrioMU
/// en la tablet (http://127.0.0.1:3400/sabio), que lleva la personalidad, el limite diario y
/// la llamada al modelo. Se hace en segundo plano: el juego nunca espera a la IA.
/// La IA no tiene ninguna herramienta que de items, puntos ni monedas.
/// </remarks>
[PlugIn]
[Display(Name = "BarrioMU: El Sabio del Barrio (/ia)", Description = "Comando /ia: preguntas a la IA del servidor, que contesta por susurro con los datos reales del personaje.")]
[Guid("5A6B7C8D-9E0F-4A1B-8C2D-3E4F5A6B7C81")]
public class BarrioSabioPlugIn : IChatCommandPlugIn
{
    private const string Command = "/ia";

    private const string SabioName = "Sabio";

    private const int MaxQuestionLength = 300;

    private static readonly string ApiUrl = Environment.GetEnvironmentVariable("BARRIO_SABIO_URL") ?? "http://127.0.0.1:3400/sabio";

    private static readonly string SecretPath = Path.Combine(AppContext.BaseDirectory, "data", "sabio-secreto.txt");

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(40) };

    /// <summary>Quienes estan esperando respuesta: una pregunta a la vez por personaje.</summary>
    private static readonly HashSet<string> Waiting = new(StringComparer.OrdinalIgnoreCase);

    private static readonly Lock WaitingLock = new();

    /// <inheritdoc />
    public string Key => Command;

    /// <inheritdoc />
    public CharacterStatus MinCharacterStatusRequirement => CharacterStatus.Normal;

    /// <inheritdoc />
    public async ValueTask HandleCommandAsync(Player player, string command)
    {
        if (player.SelectedCharacter is not { } character || player.Account is not { } account)
        {
            return;
        }

        var question = command.Length > Command.Length ? command[Command.Length..].Trim() : string.Empty;
        if (question.Length == 0)
        {
            await WhisperAsync(player, "Hola pana, soy el Sabio del Barrio. Preguntame con /ia y tu pregunta. Ej: /ia cuanto me falta para el reset?").ConfigureAwait(false);
            return;
        }

        if (question.Length > MaxQuestionLength)
        {
            question = question[..MaxQuestionLength];
        }

        var secret = ReadSecret();
        if (secret is null)
        {
            await WhisperAsync(player, "El Sabio esta durmiendo (falta configurarlo). Avisale al admin.").ConfigureAwait(false);
            return;
        }

        lock (WaitingLock)
        {
            if (!Waiting.Add(character.Name ?? string.Empty))
            {
                _ = WhisperAsync(player, "Calma pana, todavia estoy pensando lo anterior...").AsTask();
                return;
            }
        }

        // Los datos los pone el servidor: el jugador no puede hacerse pasar por otro.
        var request = new SabioRequest(
            secret,
            account.LoginName ?? string.Empty,
            character.Name ?? string.Empty,
            character.CharacterClass?.Name.ToString() ?? string.Empty,
            (int)(player.Attributes?[Stats.Level] ?? 0),
            (int)(player.Attributes?[Stats.MasterLevel] ?? 0),
            (int)(player.Attributes?[Stats.Resets] ?? 0),
            player.Money,
            account.GoblinPoints,
            account.WCoinC,
            account.WCoinP,
            player.CurrentMap?.Definition.Name.ToString() ?? string.Empty,
            question);

        await WhisperAsync(player, "Dejame pensar...").ConfigureAwait(false);
        _ = Task.Run(() => AskAsync(player, request));
    }

    private static async Task AskAsync(Player player, SabioRequest request)
    {
        try
        {
            using var response = await Http.PostAsJsonAsync(ApiUrl, request).ConfigureAwait(false);
            var answer = await response.Content.ReadFromJsonAsync<SabioResponse>().ConfigureAwait(false);
            var lines = answer?.Lines is { Length: > 0 } got ? got : new[] { "No te entendi bien, pana. Preguntame otra vez." };
            foreach (var line in lines.Take(8))
            {
                await WhisperAsync(player, line).ConfigureAwait(false);
            }
        }
        catch
        {
            await WhisperAsync(player, "Se me fue la senal, pana. Intenta en un rato.").ConfigureAwait(false);
        }
        finally
        {
            lock (WaitingLock)
            {
                Waiting.Remove(request.Character);
            }
        }
    }

    private static async ValueTask WhisperAsync(Player player, string text)
    {
        try
        {
            await player.InvokeViewPlugInAsync<IChatViewPlugIn>(p => p.ChatMessageAsync(text, SabioName, ChatMessageType.Whisper)).ConfigureAwait(false);
        }
        catch
        {
            // El jugador se fue mientras el Sabio pensaba.
        }
    }

    private static string? ReadSecret()
    {
        try
        {
            var text = File.Exists(SecretPath) ? File.ReadAllText(SecretPath).Trim() : string.Empty;
            return text.Length >= 16 ? text : null;
        }
        catch
        {
            return null;
        }
    }

    private sealed record SabioRequest(
        [property: JsonPropertyName("secret")] string Secret,
        [property: JsonPropertyName("login")] string Login,
        [property: JsonPropertyName("character")] string Character,
        [property: JsonPropertyName("class")] string Class,
        [property: JsonPropertyName("level")] int Level,
        [property: JsonPropertyName("masterLevel")] int MasterLevel,
        [property: JsonPropertyName("resets")] int Resets,
        [property: JsonPropertyName("zen")] long Zen,
        [property: JsonPropertyName("points")] int Points,
        [property: JsonPropertyName("wcoinc")] int WCoinC,
        [property: JsonPropertyName("wcoinp")] int WCoinP,
        [property: JsonPropertyName("map")] string Map,
        [property: JsonPropertyName("message")] string Message);

    private sealed record SabioResponse([property: JsonPropertyName("lines")] string[]? Lines);
}

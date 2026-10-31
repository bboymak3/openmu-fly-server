// <copyright file="BarrioStore.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic.PlugIns;

using System.IO;
using System.Text.Json;
using System.Threading;

/// <summary>
/// BarrioMU: a small JSON file next to the server (data/&lt;name&gt;.json) that
/// keeps data of the BarrioMU plugins. The API of the landing (babylon/api)
/// reads and writes the same files, so every change is made under a lock file
/// and replaces the file in one step (write to a temporary file, then rename).
/// </summary>
/// <typeparam name="TValue">The type of the values, by key.</typeparam>
public sealed class BarrioStore<TValue>
{
    private static readonly TimeSpan StaleLockAge = TimeSpan.FromSeconds(10);

    private readonly string _path;

    private readonly string _lockPath;

    private readonly Lock _sync = new();

    /// <summary>
    /// Initializes a new instance of the <see cref="BarrioStore{TValue}"/> class.
    /// </summary>
    /// <param name="name">The name of the file, without extension.</param>
    public BarrioStore(string name)
    {
        this._path = Path.Combine(AppContext.BaseDirectory, "data", name + ".json");
        this._lockPath = this._path + ".lock";
    }

    /// <summary>
    /// Gets the value of a key, or the default if there is none or the file can't be read.
    /// </summary>
    /// <param name="key">The key.</param>
    /// <returns>The value.</returns>
    public TValue? Get(string key)
    {
        return this.Read().TryGetValue(key, out var value) ? value : default;
    }

    /// <summary>
    /// Changes the value of one key.
    /// </summary>
    /// <param name="key">The key.</param>
    /// <param name="update">Gets the current value (or default) and returns the new one.</param>
    /// <returns><c>true</c> if the file was written.</returns>
    public bool Update(string key, Func<TValue?, TValue> update)
    {
        lock (this._sync)
        {
            using var fileLock = this.AcquireFileLock();
            if (fileLock is null)
            {
                return false;
            }

            try
            {
                var all = this.Read();
                all[key] = update(all.TryGetValue(key, out var current) ? current : default);
                Directory.CreateDirectory(Path.GetDirectoryName(this._path)!);
                var temp = this._path + ".tmp";
                File.WriteAllText(temp, JsonSerializer.Serialize(all));
                File.Move(temp, this._path, true);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }
    }

    private Dictionary<string, TValue> Read()
    {
        try
        {
            if (File.Exists(this._path)
                && JsonSerializer.Deserialize<Dictionary<string, TValue>>(File.ReadAllText(this._path)) is { } stored)
            {
                return new Dictionary<string, TValue>(stored, StringComparer.OrdinalIgnoreCase);
            }
        }
        catch (Exception)
        {
            // A broken or half written file reads as empty.
        }

        return new Dictionary<string, TValue>(StringComparer.OrdinalIgnoreCase);
    }

    private FileStream? AcquireFileLock()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(this._lockPath)!);
        }
        catch (Exception)
        {
            return null;
        }

        for (var attempt = 0; attempt < 50; attempt++)
        {
            try
            {
                return new FileStream(this._lockPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose);
            }
            catch (IOException)
            {
                try
                {
                    // A lock left behind by a process that died.
                    if (DateTime.UtcNow - File.GetLastWriteTimeUtc(this._lockPath) > StaleLockAge)
                    {
                        File.Delete(this._lockPath);
                        continue;
                    }
                }
                catch (Exception)
                {
                    // try again
                }

                Thread.Sleep(100);
            }
            catch (Exception)
            {
                return null;
            }
        }

        return null;
    }
}

/**
 * 🎵 YouTube Music Downloader & Player (Node.js)
 *
 * 📦 Required Packages (Install via npm):
 *   npm install axios node-id3 inquirer play-sound
 *
 * 🛠️ External Dependencies (Install manually):
 *   1. yt-dlp      - https://github.com/yt-dlp/yt-dlp
 *       Install via pip:
 *         pip install -U yt-dlp
 *
 *   2. ffmpeg      - https://ffmpeg.org/download.html
 *       Must be available in your system PATH.
 *
 *   3. Audio Player (one of the following):
 *       - mpg123  (Linux/macOS)
 *       - afplay  (macOS)
 *       - ffplay  (from ffmpeg)
 *       - vlc     (cross-platform)
 *     Make sure one of these is installed and available in PATH.
 *
 * ✅ Usage:
 *   node index.js --song "https://www.youtube.com/watch?v=..."
 *   node index.js --playlist "https://www.youtube.com/playlist?list=..."
 *   node index.js --play
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import axios from "axios";
import NodeID3 from "node-id3";
import inquirer from "inquirer";
import player from "play-sound";

// Directory to store downloaded music
const MUSIC_DIR = "Music";

// Create player with fallback support
const play = player({ players: ["mpg123", "afplay", "ffplay", "vlc"] });

// Create Music folder if it doesn't exist
if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR);
}

// Helper: Run shell commands with output
function runCmd(cmd) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: "inherit" });
}

// Download a single song from YouTube
async function downloadSong(url) {
  console.log("🎵 Fetching video info...");

  const infoJSON = execSync(`yt-dlp -j "${url}"`).toString();
  const info = JSON.parse(infoJSON);

  // Extract metadata
  const artist = sanitize(info.artist || info.uploader || "Unknown");
  const title = sanitize(info.track || info.title);
  const videoId = info.id;
  const thumbnail = info.thumbnail;

  // Create artist folder
  const artistDir = path.join(MUSIC_DIR, artist);
  if (!fs.existsSync(artistDir)) fs.mkdirSync(artistDir, { recursive: true });

  const finalPath = path.join(artistDir, `${title}.mp3`);

  // Skip if already exists
  if (fs.existsSync(finalPath)) {
    console.log(`✅ Already downloaded: ${title}`);
    return;
  }

  console.log(`⬇️ Downloading: ${title}`);

  const tempFile = `${videoId}.webm`;
  runCmd(`yt-dlp -f bestaudio -o "${tempFile}" "${url}"`);

  // Convert to mp3
  const tempMp3 = `${videoId}.mp3`;
  runCmd(`ffmpeg -i "${tempFile}" -q:a 0 -map a "${tempMp3}"`);
  fs.unlinkSync(tempFile);

  // Download thumbnail for cover
  const coverPath = "cover.jpg";
  const imgData = await axios.get(thumbnail, { responseType: "arraybuffer" });
  fs.writeFileSync(coverPath, imgData.data);

  // Add ID3 tags (title, artist, album, cover)
  const tags = {
    title: info.track || info.title,
    artist: info.artist || info.uploader || "Unknown",
    album: info.album || info.artist || info.uploader || "YouTube",
    APIC: coverPath,
  };
  NodeID3.write(tags, tempMp3);

  // Move to final location
  fs.renameSync(tempMp3, finalPath);
  if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);

  console.log(`✅ Saved: ${finalPath}`);
}

// Download an entire playlist
async function downloadPlaylist(playlistUrl) {
  console.log("📜 Fetching playlist...");

  // Skip 'start_radio' links
  if (playlistUrl.includes("start_radio")) {
    console.log("⚠️ Skipping start_radio link – not supported.");
    return;
  }

  // 📃 Get video IDs from playlist
  const jsonList = execSync(`yt-dlp -j --flat-playlist "${playlistUrl}"`)
    .toString()
    .trim()
    .split("\n");

  for (const line of jsonList) {
    const entry = JSON.parse(line);
    const videoUrl = `https://www.youtube.com/watch?v=${entry.id}`;
    try {
      await downloadSong(videoUrl);
    } catch (err) {
      console.error(`❌ Failed to download ${videoUrl}:`, err.message);
    }
  }
}

// Play downloaded songs using local audio player
async function playDownloadedSongs(isRandom = false, specificArtist = null) {
  let songPaths = [];

  if (specificArtist) {
    const artistDir = path.join(MUSIC_DIR, specificArtist);
    if (!fs.existsSync(artistDir)) {
      console.log(`❌ Artist not found: ${specificArtist}`);
      return;
    }

    const songs = fs.readdirSync(artistDir).map((song) => ({
      path: path.join(artistDir, song),
      name: `${specificArtist} - ${song}`,
    }));
    songPaths.push(...songs);
  } else {
    const artists = fs.readdirSync(MUSIC_DIR);

    for (const artist of artists) {
      const artistDir = path.join(MUSIC_DIR, artist);
      const songs = fs.readdirSync(artistDir).map((song) => ({
        path: path.join(artistDir, song),
        name: `${artist} - ${song}`,
      }));
      songPaths.push(...songs);
    }
  }

  if (songPaths.length === 0) {
    console.log("❌ No songs found.");
    return;
  }

  if (isRandom) {
    // Random autoplay
    songPaths = songPaths.sort(() => Math.random() - 0.5);

    for (const song of songPaths) {
      console.log(`🎶 Now playing: ${song.name}`);
      try {
        await new Promise((resolve, reject) => {
          const audio = play.play(song.path, function (err) {
            if (err && !err.killed) reject(err);
            else resolve();
          });

          // Ensure the player process ends properly
          if (audio && audio.on) {
            audio.on("exit", resolve);
            audio.on("error", reject);
          }
        });
      } catch (err) {
        console.error(`⚠️ Could not play ${song.name}:`, err.message || err);
      }
    }

    console.log("✅ All songs finished.");
  } else {
    // Manual selection & next prompt loop
    let continuePlaying = true;
    let remainingSongs = [...songPaths];

    while (continuePlaying && remainingSongs.length > 0) {
      const { songToPlay } = await inquirer.prompt({
        type: "list",
        name: "songToPlay",
        message: "🎵 Choose a song to play:",
        choices: remainingSongs.map((s) => s.name),
      });

      const selected = remainingSongs.find((s) => s.name === songToPlay);
      if (!selected) {
        console.log("⚠️ Song not found.");
        break;
      }

      console.log(`🎶 Now playing: ${selected.name}`);
      try {
        await new Promise((resolve, reject) => {
          const audio = play.play(selected.path, function (err) {
            if (err && !err.killed) reject(err);
            else resolve();
          });

          // Ensure the player process ends properly
          if (audio && audio.on) {
            audio.on("exit", resolve);
            audio.on("error", reject);
          }
        });
      } catch (err) {
        console.error(
          `⚠️ Could not play ${selected.name}:`,
          err.message || err
        );
      }

      // Remove played song from list
      remainingSongs = remainingSongs.filter((s) => s.name !== selected.name);

      if (remainingSongs.length === 0) {
        console.log("✅ All songs played.");
        break;
      }

      const { nextAction } = await inquirer.prompt({
        type: "list",
        name: "nextAction",
        message: "⏭️  Play next song or exit?",
        choices: ["▶️  Play next", "❌ Exit"],
      });

      continuePlaying = nextAction === "▶️ Play next";
    }
  }
}

// Sanitize filename to remove forbidden characters
function sanitize(str) {
  return str.replace(/[<>:"/\\|?*]+/g, "_");
}

// CLI Entry
const args = process.argv.slice(2);
if (args.length < 1) {
  console.log(`
Usage:
  node index.js --song "youtube-url"              # Download single song
  node index.js --playlist "playlist-url"         # Download entire playlist
  node index.js --play                            # Manual choose artist & song
  node index.js --play --random                   # Random all songs
  node index.js --play --artist "Eminem"          # Pick song manually from Eminem
  node index.js --play --artist "Eminem" --random # Play all Eminem songs randomly
`);
  process.exit(0);
}

const mode = args[0];
const query = args[1];

(async () => {
  if (mode === "--song") {
    await downloadSong(query);
  } else if (mode === "--playlist") {
    await downloadPlaylist(query);
  } else if (mode === "--play") {
    const isRandom = args.includes("--random");

    // Get --artist argument value (if present)
    const artistFlagIndex = args.findIndex((arg) => arg === "--artist");
    let specificArtist = null;
    if (artistFlagIndex !== -1 && args[artistFlagIndex + 1]) {
      specificArtist = args[artistFlagIndex + 1];
    }

    await playDownloadedSongs(isRandom, specificArtist);
  } else {
    console.log("❓ Unknown mode! Use --song, --playlist or --play");
  }
})();

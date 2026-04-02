import { select, confirm, number } from "@inquirer/prompts";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

// --- Options extracted from CLI binary ---

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;

const SPECIES = [
  "duck", "goose", "blob", "cat", "dragon", "octopus", "owl", "penguin",
  "turtle", "snail", "ghost", "axolotl", "capybara", "cactus", "robot",
  "rabbit", "mushroom", "chonk",
] as const;

const EYES = ["·", "✦", "×", "◉", "@", "°"] as const;

const HATS = [
  "none", "crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck",
] as const;

const STATS = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"] as const;

const INSTALL_METHODS = [
  { name: "npm global (npm install -g @anthropic-ai/claude-code)", value: "npm-global" },
  { name: "Native install script (curl-based installer)", value: "native" },
] as const;

type InstallMethod = (typeof INSTALL_METHODS)[number]["value"];

// --- Paths ---

const CLAUDE_JSON = join(homedir(), ".claude.json");
const CLAUDE_JSON_BACKUP = join(homedir(), ".claude.json.backup");

// --- Helpers ---

function toChoices<T extends string>(items: readonly T[]) {
  return items.map((item) => ({ name: item, value: item }));
}

function resolveCliBinaryPath(method: InstallMethod): string {
  const CLAUDE_CODE_PKG = "@anthropic-ai/claude-code/cli.js";

  switch (method) {
    case "npm-global": {
      const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
      return join(npmRoot, CLAUDE_CODE_PKG);
    }
    case "native": {
      return join(homedir(), ".claude/local", CLAUDE_CODE_PKG);
    }
  }
}

// --- Step 1: Backup & strip companion ---

function backupAndStripCompanion() {
  console.log("\n📦 Backing up .claude.json...");
  copyFileSync(CLAUDE_JSON, CLAUDE_JSON_BACKUP);
  console.log(`   Saved to ${CLAUDE_JSON_BACKUP}`);

  const data = JSON.parse(readFileSync(CLAUDE_JSON, "utf8"));
  if (data.companion) {
    delete data.companion;
    writeFileSync(CLAUDE_JSON, JSON.stringify(data, null, 2));
    console.log("   Removed companion from .claude.json\n");
  } else {
    console.log("   No companion found in .claude.json (already clean)\n");
  }
}

// --- Step 2: Interactive picker ---

async function pickBuddyProperties() {
  const installMethod = await select({
    message: "How did you install Claude Code?",
    choices: [...INSTALL_METHODS],
  });

  const cliPath = resolveCliBinaryPath(installMethod);
  if (!existsSync(cliPath)) {
    console.error(`\n❌ CLI binary not found at: ${cliPath}`);
    console.error("   Please check your installation and try again.");
    process.exit(1);
  }
  console.log(`   Found CLI at: ${cliPath}\n`);

  console.log("🎨 Pick your buddy's properties:\n");

  const rarity = await select({
    message: "Rarity",
    choices: toChoices(RARITIES),
  });

  const species = await select({
    message: "Species",
    choices: toChoices(SPECIES),
  });

  const eye = await select({
    message: "Eye",
    choices: toChoices(EYES),
  });

  const hat = await select({
    message: "Hat",
    choices: toChoices(HATS),
  });

  const shiny = await confirm({
    message: "Shiny?",
    default: true,
  });

  console.log("\n📊 Set stats (0-100):\n");

  const stats: Record<string, number> = {};
  for (const stat of STATS) {
    const value = await number({
      message: stat,
      min: 0,
      max: 100,
      default: 100,
    });
    stats[stat] = value ?? 100;
  }

  return { cliPath, rarity, species, eye, hat, shiny, stats };
}

// --- Step 3: Patch CLI binary ---

function patchCliBinary(cliPath: string, choices: {
  rarity: string;
  species: string;
  eye: string;
  hat: string;
  shiny: boolean;
  stats: Record<string, number>;
}) {
  console.log("\n🔧 Patching CLI binary...");

  const cliSource = readFileSync(cliPath, "utf8");

  const pattern =
    /function \w+\(\w+\)\{let \w+=\w+\(\w+\);return\{bones:\{rarity:\w+,species:\w+\(\w+,\w+\),eye:\w+\(\w+,\w+\),hat:\w+===.common.\?.none.:\w+\(\w+,\w+\),shiny:\w+\(\)<[\d.]+,stats:\w+\(\w+,\w+\)\},inspirationSeed:Math\.floor\(\w+\(\)\*1e9\)\}\}/;

  const match = cliSource.match(pattern);
  if (!match) {
    console.error("❌ Could not find buddy generation function in cli.js.");
    console.error("   The CLI binary format may have changed. Try running: npm install");
    process.exit(1);
  }

  // Extract the original function name so other code can still reference it
  const origFnName = match[0].match(/^function (\w+)/)![1];

  const replacement = `function ${origFnName}(q){return{bones:{rarity:${JSON.stringify(choices.rarity)},species:${JSON.stringify(choices.species)},eye:${JSON.stringify(choices.eye)},hat:${JSON.stringify(choices.hat)},shiny:${choices.shiny},stats:${JSON.stringify(choices.stats)}},inspirationSeed:Math.floor(q()*1e9)}}`;

  const patched = cliSource.replace(pattern, replacement);
  writeFileSync(cliPath, patched);
  console.log("   Patched successfully!\n");
}

// --- Main ---

async function main() {
  console.log("╔══════════════════════════════════╗");
  console.log("║     🐾 Claude Buddy Picker 🐾    ║");
  console.log("╚══════════════════════════════════╝");

  backupAndStripCompanion();

  const choices = await pickBuddyProperties();

  console.log("\n✨ Your buddy:");
  console.log(`   Rarity:  ${choices.rarity}`);
  console.log(`   Species: ${choices.species}`);
  console.log(`   Eye:     ${choices.eye}`);
  console.log(`   Hat:     ${choices.hat}`);
  console.log(`   Shiny:   ${choices.shiny}`);
  console.log(`   Stats:   ${Object.entries(choices.stats).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const proceed = await confirm({
    message: "Patch CLI with these values?",
    default: true,
  });

  if (!proceed) {
    console.log("Aborted.");
    process.exit(0);
  }

  patchCliBinary(choices.cliPath, choices);

  console.log("🎉 Done! Now:");
  console.log("   1. Run: claude");
  console.log("   2. Type: /buddy");
  console.log("   3. Enjoy your custom buddy!\n");
  console.log("   (To restore original CLI, run: npm install)");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

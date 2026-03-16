# How to Play DnDnAi

A quick guide for new players. No D&D experience required.

## What Is This?

DnDnAi is a D&D game that runs in Discord. An AI plays the Dungeon Master (the storyteller who controls the world), and you play a character. AI party members join you as companions. You explore, fight monsters, solve puzzles, and level up — all through text in a Discord channel.

## Getting Started (5 minutes)

1. **Get a character sheet.** You need a `.md` text file with your character's stats. Three options:
   - Copy the sample: [`characters/sample-character.md`](../characters/sample-character.md)
   - Ask any AI to generate one (see [creating-characters.md](creating-characters.md) for a prompt template)
   - Build one from scratch using the template in [creating-characters.md](creating-characters.md)

2. **Join the game.** In the Discord channel:
   - `/join` → attach your `.md` file
   - The bot parses your sheet and adds you to the party

3. **Play.** Type `>` followed by what your character does:
   ```
   > I draw my sword and cautiously approach the door
   > "Who goes there?" I call out into the darkness
   > I check the chest for traps before opening it
   ```

That's it. The DM handles the rest — dice, rules, narration, everything.

## The Basics

### How to Act
- **`> your action`** — act in character (this is how you play)
- **Plain messages** (no `>`) — out-of-character chat, doesn't affect the game
- **`/pass`** — skip your turn

### How Turns Work
1. The DM describes a scene
2. You and your party members act (using `> action`)
3. The DM resolves everything — rolls dice, applies damage, narrates what happens
4. Repeat

In combat, turns follow initiative order (the DM rolls for everyone at the start). The game always waits for you — it never auto-advances past a human player.

### How Combat Works
- The DM describes enemies and the situation
- On your turn, describe what you do: `> I attack the goblin` or `> I cast Shield`
- The engine rolls real dice, tracks HP, applies damage/healing
- If you drop to 0 HP, death saves are rolled automatically at the start of your turns
- Combat ends when the DM says it's over

### How Magic Works
- Your spell slots are tracked automatically — you don't need to count them
- If you try to cast a spell and you're out of slots, the engine warns you
- Concentration spells are tracked: if you take damage, the engine auto-rolls to see if you maintain focus
- Use `/rest short` or `/rest long` to get your slots back

## Commands Reference

### Always Available
| Command | What It Does |
|---------|-------------|
| `/ask question` | Ask the DM anything (rules, options, lore) — doesn't use your turn |
| `/character` | See your stats, HP, spell slots, feature charges, XP |
| `/character spells` | Just your spells and remaining slots |
| `/inventory` | Your equipment |
| `/roll 2d6+3` | Roll dice yourself |
| `/status` | See the whole party's HP |
| `/whisper @player msg` | Private message to another player (only they and the DM see it) |
| `/recap` | DM summarizes the story so far |

### Between Fights
| Command | What It Does |
|---------|-------------|
| `/rest short` | Recover short-rest features (Action Surge, Second Wind, etc.) |
| `/rest long` | Full recovery — HP to max, all spell slots and features reset |

### Progression
| Command | What It Does |
|---------|-------------|
| `/level-up` | Level up when you have enough XP (uses fixed HP average by default) |
| `/level-up hp:Roll` | Level up and roll for HP instead of taking the average |

## Things You Don't Need to Worry About

The engine handles all of this automatically:
- **Dice** — the DM requests rolls, the engine rolls real random dice
- **Spell slots** — tracked and deducted when you cast
- **Feature charges** — "1/short rest", "3/long rest" etc. tracked and reset on rests
- **Death saves** — auto-rolled at 0 HP
- **Concentration** — tracked, auto-broken on failed CON save after damage
- **Conditions** — prone, frightened, etc. tracked with mechanical notes on rolls
- **XP** — awarded by the DM, tracked on your character sheet
- **Saving throws** — the DM sees your exact modifiers, no math errors

## FAQ

**Q: I've never played D&D. Can I still play?**
Yes. Just describe what your character does in plain English. The DM handles all the rules. Use `/ask` anytime you're confused.

**Q: How do I make a character if I don't know D&D?**
Ask any AI (Claude, ChatGPT) to generate one. See [creating-characters.md](creating-characters.md) for the exact prompt to use.

**Q: What if I mess up my action?**
Nothing is permanent until the DM narrates it. If you say something you didn't mean, just say so out-of-character (without `>`).

**Q: Can I play a class/race that isn't listed?**
Yes — any D&D 5e class and race works. The bot's character parser is flexible. The DM AI knows the rules for all standard 5e content.

**Q: How do I level up?**
The DM awards XP after combat and milestones. When you have enough, the engine tells you. Use `/level-up` to apply it. The command handles HP, proficiency, and spell slots. For new class features, use `/ask What did I gain at level X?`

**Q: What happens if I die?**
At 0 HP, you make death saves automatically. Three successes and you stabilize. Three failures and you're dead. A natural 20 brings you back with 1 HP. Healing from an ally clears your death saves.

**Q: Can I see what the AI party members are doing?**
Yes — they post in the same channel as regular Discord messages, each with their own name and avatar. They act automatically on their turns.

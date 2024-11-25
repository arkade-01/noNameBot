import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { join } from 'path';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);

// Load and register all commands
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter((file) => file.endsWith('.ts') || file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(join(commandsPath, file)).default;
    if (typeof command === 'function') {
        command(bot);
    }
}

bot.launch();
console.log('Bot launched successfully!');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

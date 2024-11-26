import { Telegraf, Context, Markup } from "telegraf";
import getUser from "../helper_functions/getUserInfo";

const escapeMarkdownV2 = (text: string): string => {
    return text.replace(/([_*\[\]()~`>#+-=|{}.!])/g, '\\$1');
};

const walletCommand = (bot: Telegraf<Context>) => {
    bot.action("wallets", async (ctx) => {
        const telegram_id = ctx.from?.id.toString() || "";

        try {
            const userDetails = await getUser(telegram_id);

            // Check if user details are available
            if (!userDetails || !userDetails.walletAddress || !userDetails.privateKey) {
                ctx.reply(
                    "⚠️ I couldn't fetch your wallet details\\. It seems like your wallet hasn't been created yet\\. Please try again later or contact support\\."
                );
                return;
            }

            // Escape special characters in wallet details
            const escapedWalletAddress = escapeMarkdownV2(userDetails.walletAddress);
            const escapedPrivateKey = escapeMarkdownV2(userDetails.privateKey);

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('Main Menu', 'start')],
            ])
            // Format the wallet details with escaped characters
            const formattedWalletDetails = `🌟 *Your Solana Wallet Details* 🌟\n\n` +
                `🔑 *Wallet Address:* \n\`${escapedWalletAddress}\`\n\n` +
                `🛡️ *Private Key:* \n\`${escapedPrivateKey}\`\n\n` +
                `💡 *Important:* Keep your private key secure and never share it with anyone\\. It gives full access to your funds\\.`;

            // Send the response with Markdown formatting
            ctx.reply(formattedWalletDetails, { parse_mode: "MarkdownV2",
                ...keyboard
             });
        } catch (error) {
            // Handle unknown error type by narrowing it down
            if (error instanceof Error) {
                console.error("Error in walletCommand:", error.message);
                ctx.reply(
                    "❌ An error occurred while fetching your wallet details\\. Please try again later or contact support\\."
                );
            } else {
                // Handle non-Error exceptions
                console.error("Unexpected error in walletCommand:", error);
                ctx.reply(
                    "❌ An unexpected error occurred\\. Please try again later or contact support\\."
                );
            }
        }
    });
};

export default walletCommand;
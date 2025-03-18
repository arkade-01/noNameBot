import { Markup, Telegraf } from "telegraf";
import { BotContext } from "../helper_functions/botContext";
import User from "../models/schema";
import { generateReferralCode } from "../helper_functions/refferal";


const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('Main Menu', 'start'),
    Markup.button.callback('Refferals', 'myreferrals')
        ]
    ]);

    
// Create a Referral command handler
const Referral = (bot: Telegraf<BotContext>) => {

  // Handle the /referral command
  bot.command("referral", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      // Get user from the database
      let user = await User.findOne({ telegram_id: userId.toString() });

      if (!user) {
        ctx.reply("You need to set up your wallet first. Please use /start to begin.");
        return;
      }

      // Generate a referral code if user doesn't have one
      if (!user.referralCode) {
        user.referralCode = generateReferralCode(userId.toString());
        await user.save();
      }

      // Generate a referral link
      const referralLink = `https://t.me/${ctx.botInfo.username}?start=REF_${user.referralCode}`;

      // Default to 0 if undefined
      const referralCount = user.referralCount || 0;
      const referralRewards = user.referralRewards || 0;

      // Create the referral message
      const referralMessage = [
        `🎁 <b>Your Referral Program</b>`,
        ``,
        `Share this link with your friends to earn rewards:`,
        ``,
        `${referralLink}`,
        ``,
        `You have invited: <b>${referralCount}</b> friends`,
        `Total rewards earned: <b>${referralRewards} </b>`,
        ``,
        `For each friend who joins with your link, you will earn 1 POINT!`
      ].join('\n');

      // Send the referral link to the user
      await ctx.reply(referralMessage, { parse_mode: "HTML" });
    } catch (error) {
      console.error("Error in referral command:", error);
      ctx.reply("Sorry, there was an error generating your referral link. Please try again later.");
    }
  });

  // Add a command to view your referrals list
  bot.action("myreferrals", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const user = await User.findOne({ telegram_id: userId.toString() });

      if (!user) {
        await ctx.reply("You need to set up your wallet first. Please use /start to begin.");
        return;
      }

      if (!user.referrals || user.referrals.length === 0) {
        await ctx.reply("You haven't referred anyone yet. Use /referral to get your referral link!");
        return;
      }

      // Create a list of referrals with dates
      let referralsList = "🔍 <b>Your Referrals</b>\n\n";

      user.referrals.forEach((ref, index) => {
        const date = new Date(ref.createdAt).toLocaleDateString();
        referralsList += `${index + 1}. User joined: ${date}\n`;
      });

      referralsList += `\nTotal referrals: <b>${user.referralCount}</b>\n`;
      referralsList += `Total rewards earned: <b>${user.referralRewards || 0}</b>`;

      await ctx.reply(referralsList, { parse_mode: "HTML" });
    } catch (error) {
      console.error("Error in myreferrals command:", error);
      await ctx.reply("Sorry, there was an error retrieving your referrals.");
    }
  });

  // Referral button action
  bot.action('referral', async (ctx) => {
    try {
      await ctx.answerCbQuery(); // Acknowledge the button click

      const userId = ctx.from?.id;
      if (!userId) return;

      // Get user from the database
      let user = await User.findOne({ telegram_id: userId.toString() });

      if (!user) {
        await ctx.reply("Unable to find your user account. Please try restarting the bot.");
        return;
      }

      // Generate a referral code if user doesn't have one
      if (!user.referralCode) {
        user.referralCode = generateReferralCode(userId.toString());
        await user.save();
      }

      // Generate a referral link
      const referralLink = `https://t.me/${ctx.botInfo.username}?start=REF_${user.referralCode}`;

      // Default to 0 if undefined
      const referralCount = user.referralCount || 0;
      const referralRewards = user.referralRewards || 0;

      // Send the referral link to the user
      const referralMessage = [
        `🎁 <b>Your Referral Program</b>`,
        ``,
        `Share this link with your friends to earn rewards:`,
        ``,
        `${referralLink}`,
        ``,
        `You have invited: <b>${referralCount}</b> friends`,
        `Total rewards earned: <b>${referralRewards} POINTS</b>`,
        ``,
        `For each friend who joins with your link, you will earn 1 POINT!`
      ].join('\n');

      await ctx.reply(referralMessage, { parse_mode: "HTML", 
        ...keyboard});
    } catch (error) {
      console.error("Error in referral action:", error);
      await ctx.reply("Sorry, there was an error with the referral system. Please try again later.");
    }
  });
};

export default Referral;
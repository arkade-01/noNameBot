import { Context, Telegraf } from "telegraf";
import { BotContext } from "./botContext";
import User from "../models/schema";

// Helper function to generate a unique referral code
export const generateReferralCode = (userId: string): string => {
  // Create a readable but unique code combining user ID and timestamp
  const timeComponent = Date.now().toString(36).slice(-4);
  const userComponent = userId.slice(-4);
  const randomComponent = Math.floor(Math.random() * 10000).toString().padStart(4, '0');

  return `${userComponent}${timeComponent}${randomComponent}`;
};

// Process rewards for successful referrals
export const processReferralReward = async (bot: Telegraf<BotContext>, referrer: any) => {
  try {
    // Example reward structure - customize based on your needs
    const REFERRAL_REWARD = 1; // SOL reward per referral

    // Add reward to user's balance
    referrer.referralRewards = (referrer.referralRewards || 0) + REFERRAL_REWARD;
    referrer.userBalance += REFERRAL_REWARD; // Add to actual balance

    await referrer.save();

    // Notify user about the reward
    await bot.telegram.sendMessage(
      referrer.telegram_id,
      `💰 You've earned a referral reward of ${REFERRAL_REWARD} POINT!\n\nYour total referral rewards: ${referrer.referralRewards.toFixed(2)} POINTS`
    );
  } catch (error) {
    console.error("Error processing reward:", error);
  }
};

// Helper function to handle referral processing
export async function handleReferral(
  ctx: Context,
  bot: Telegraf<BotContext>,
  userId: string,
  referralCode: string
): Promise<void> {
  try {
    // Check if user already exists
    let user = await User.findOne({ telegram_id: userId });

    // If user exists, handle the referral process
    if (user) {
      // If user already has a referrer, don't process again
      if (user.referredBy) {
        await ctx.reply("You've already joined through a referral link!");
        return;
      }

      // Find the referrer
      const referrer = await User.findOne({ referralCode: referralCode });

      if (!referrer) {
        return; // Invalid referral code, just continue with normal start
      }

      // Prevent self-referrals
      if (referrer.telegram_id === userId) {
        await ctx.reply("You cannot refer yourself!");
        return;
      }

      // Update user with referrer information
      user.referredBy = referrer.telegram_id;
      await user.save();

      // Update referrer's stats
      referrer.referralCount = (referrer.referralCount || 0) + 1;

      // Initialize referrals array if it doesn't exist
      if (!referrer.referrals) {
        referrer.referrals = [];
      }

      // Add this user to referrer's referrals list
      referrer.referrals.push({
        code: referralCode,
        createdAt: new Date(),
        referredUser: user.telegram_id
      });

      await referrer.save();

      // Process rewards for the referrer
      await processReferralReward(bot, referrer);

      await ctx.reply("Welcome! You joined via a referral link from another trader!");

      // Notify the referrer
      try {
        await bot.telegram.sendMessage(
          referrer.telegram_id,
          `🎉 Congratulations! A new user has joined using your referral link. Your referral count is now ${referrer.referralCount}.`
        );
      } catch (error) {
        console.error("Could not notify referrer:", error);
      }
    }
    // Handle new users in your existing onboarding flow
    // The referral code can be saved and processed after account creation
  } catch (error) {
    console.error("Error handling referral:", error);
  }
}
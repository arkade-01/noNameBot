import connectToDatabase from "../models/dbconfig";
import User from "../models/schema";
import createNewSolanaWallet from "./createWallet";
import getBalance from "./getUserbalance";

async function getUser(telegram_id: string) {
    // Check if the user already exists
    let user = await User.findOne({ telegram_id });

    if (user) {
        // Always try to update the balance for existing users
        try {
            // If no wallet address exists, create a new wallet
            if (!user.walletAddress) {
                const newWallet = await createNewSolanaWallet(telegram_id);
                user.walletAddress = newWallet.address;
                user.privateKey = newWallet.private_key;
            }

            // Fetch and update the current balance
            const currentBalance = await getBalance(user.walletAddress);
            // console.log(user.privateKey)
            // Update balance and timestamp
            user.userBalance = currentBalance;
            user.lastUpdatedbalance = new Date();

            await user.save();
            console.log(`User balance updated: ${user.walletAddress}`);

            return user;
        } catch (error) {
            console.error(`Error updating user balance: ${error}`);
            throw error;
        }
    }

    // Create a new user if not exists
    try {
        const newWallet = await createNewSolanaWallet(telegram_id);
        const initialBalance = await getBalance(newWallet.address);

        const newUser = new User({
            telegram_id,
            walletAddress: newWallet.address,
            privateKey: newWallet.private_key,
            userBalance: initialBalance,
            lastUpdatedbalance: new Date(),
        });

        await newUser.save();
        console.log(`New user created: ${newUser.walletAddress}`);
        return newUser;
    } catch (error) {
        console.error(`Error creating new user: ${error}`);
        throw error;
    }
}

export default getUser;
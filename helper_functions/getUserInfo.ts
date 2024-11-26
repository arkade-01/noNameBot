import connectToDatabase from "../models/dbconfig";
import User from "../models/schema";
import createNewSolanaWallet from "./createWallet";
import getBalance from "./getUserbalance";

async function getUser(telegram_id: string) {
    // await connectToDatabase();

    // Check if the user already exists
    let user = await User.findOne({ telegram_id });

    if (user) {
        // If the user exists but the wallet address is missing, update it
        if (!user.walletAddress) {
            const newWallet = await createNewSolanaWallet(telegram_id);
            const initialBalance = await getBalance(newWallet.address);

            // Update the user's wallet details
            user.walletAddress = newWallet.address;
            user.privateKey = newWallet.private_key;
            user.userBalance = initialBalance;
            user.lastUpdatedbalance = new Date();
            await user.save();

            console.log(`Updated user wallet: ${user}`);
        } else {
            console.log(`User found: ${user}`);
        }
        return user;
    }

    // Create a new Solana wallet for a new user
    const newWallet = await createNewSolanaWallet(telegram_id);

    // Fetch the initial balance for the new wallet
    const initialBalance = await getBalance(newWallet.address);

    // Create and save a new user
    const newUser = new User({
        telegram_id,
        walletAddress: newWallet.address,
        privateKey: newWallet.private_key, // Store the private key securely
        userBalance: initialBalance, // Save the initial balance
        lastUpdatedbalance: new Date(), // Save the current date/time
    });

    await newUser.save();
    console.log(`New user created: ${newUser}`);
    return newUser;
}

export default getUser;

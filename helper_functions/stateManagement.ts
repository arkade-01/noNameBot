// helper_functions/userStatesManager.ts

// User state interface - specific to copy trading
export interface UserState {
  waitingForTokenAddress?: boolean;
  waitingForWalletAddress?: boolean;
}

// Map to store user states
const userStates = new Map<number, UserState>();

// Set user state to waiting for token address
export function setUserInTokenAddressMode(userId: number): void {
  userStates.set(userId, {
    waitingForTokenAddress: true,
    waitingForWalletAddress: false
  });
}

// Set user state to waiting for wallet address
export function setUserInWalletAddressMode(userId: number): void {
  userStates.set(userId, {
    waitingForTokenAddress: false,
    waitingForWalletAddress: true
  });
}

// Clear user states
export function clearUserStates(userId: number): void {
  userStates.delete(userId);
}

// Get user state
export function getUserState(userId: number): UserState | undefined {
  return userStates.get(userId);
}

// Export the map for direct access if needed
export { userStates };
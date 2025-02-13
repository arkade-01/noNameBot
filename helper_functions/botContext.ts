// types/context.ts
import { Context } from 'telegraf';

interface SessionData {
    tokenCA?: string;
    amount?: number;
    awaitingCustomAmount?: boolean;
    awaitingCustomSellAmount?: boolean
}

export interface BotContext extends Context {
    session: SessionData;
}

// Initialize with empty session data
export const getInitialSessionData = (): SessionData => ({
    tokenCA: undefined
});
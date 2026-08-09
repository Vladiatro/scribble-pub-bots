import { handle } from "hono/aws-lambda"
import { Hono } from "hono"
import ScribblePubBot from "@scribble-pub/bot-sdk"

const BOT_TOKEN = process.env.BOT_TOKEN

if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN environment variable is not set")
}

const bot = new ScribblePubBot({ token: BOT_TOKEN })

bot.on("hook", async (req) => {
    return [
        {
            type: "addMessage",
            text: `Hi ${req.trigger.username}! You wrote '${req.trigger.text}' to me.`,
        },
    ]
})

const app = new Hono()

app.post("/webhook", async (c) => {
    return bot.handleHook(c.req.raw)
})

export const handler = handle(app)

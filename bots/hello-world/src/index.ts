import {handle} from "hono/aws-lambda"
import {serve} from "@hono/node-server"
import {Hono} from "hono"
import ScribblePubBot from "@scribble-pub/bot-sdk"

const BOT_TOKEN = process.env.BOT_TOKEN

if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN environment variable is not set")
}

const bot = new ScribblePubBot({token: BOT_TOKEN, baseUrl: process.env.BASE_URL})

bot.on("hook", (req) => {
    return [
        {
            type: "chat.addMessage",
            text: `Hi ${req.trigger.username}! You wrote '${req.trigger.text}' to me.`,
        },
    ]
})

const app = new Hono()

app.post("/webhook", async (c) => {
    return bot.handleHook(c.req.raw)
})

export const handler = handle(app)

if (process.env.NODE_ENV === "development") {
    const port = 3005
    console.log(`Server is running on http://localhost:${port}`)
    serve({
        fetch: app.fetch,
        port
    })
}

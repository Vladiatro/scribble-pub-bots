import {serve} from "@hono/node-server"
import {Hono} from "hono"
import ScribblePubBot from "@scribble-pub/bot-sdk"
import Renderer from "./renderer.js"

const BOT_TOKEN = process.env.BOT_TOKEN
const SERVER_PORT = parseInt(process.env.SERVER_PORT ?? "3005")

if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN environment variable is not set")
}

const bot = new ScribblePubBot({token: BOT_TOKEN, baseUrl: process.env.BASE_URL})
const renderer = new Renderer(bot)

bot.on("chat.addressed", (trigger) => {
    const enqueueMessage = renderer.enqueueExport(trigger.room, trigger.username)
    if (enqueueMessage) {
        return [
            {
                type: "chat.addMessage",
                text: enqueueMessage,
            },
        ]
    }
})

const app = new Hono()

app.post("/drawing-timelapse/webhook", async (c) => {
    return bot.handleHook(c.req.raw)
})

console.log(`Server is running on http://localhost:${SERVER_PORT}`)
serve({
    fetch: app.fetch,
    port: SERVER_PORT,
})

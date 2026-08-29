import {handle} from "hono/aws-lambda"
import {serve} from "@hono/node-server"
import {Hono} from "hono"
import ScribblePubBot, {type ChatAddressedTrigger, quoteRange, runeLength, sliceRunes} from "@scribble-pub/bot-sdk"

const BOT_TOKEN = process.env.BOT_TOKEN

if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN environment variable is not set")
}

const bot = new ScribblePubBot({token: BOT_TOKEN, baseUrl: process.env.BASE_URL})

/** Max rune (symbol) count in echoed messages. Runes prevent emoji from being cut in pieces. */
const MAX_ECHO_RUNES = 80

/** Echoes `text`, cut to {@link MAX_ECHO_RUNES} runes. */
function echo(text: string): string {
    const trimmed = text.trim()
    if (runeLength(trimmed) <= MAX_ECHO_RUNES) {
        return `“${trimmed}”`
    }
    return `“${sliceRunes(trimmed, 0, MAX_ECHO_RUNES).trimEnd()}…”`
}

/** Drops the opening tag, which the platform leaves in `text`. */
function withoutOpeningTag(text: string): string {
    return text.replace(/^\s*@\S+\s*/, "")
}

/** Names how the message reached us. https://github.com/scribble-pub/bot-sdk/blob/main/packages/bot-sdk/README.md#replies-and-quotes */
function describe(trigger: ChatAddressedTrigger, question: string): string {
    const {username, replyTo, replyToMessageId} = trigger
    const asked = question ? `You asked me: ${echo(question)}` : "You asked me nothing at all, though."

    // Not a reply, so the message opened with our tag.
    if (replyToMessageId === undefined) {
        return question
            ? `Hi ${username}! You wrote ${echo(question)} to me.`
            : `Hi ${username}! You tagged me and stopped there. Ask me something, or reply to one of my messages — I answer those too.`
    }

    // Target deleted, hidden, or expired: only its ID survived. https://github.com/scribble-pub/bot-sdk/blob/main/packages/bot-sdk/README.md#when-the-target-is-gone
    if (!replyTo) {
        return `Hi ${username}! You replied to message #${replyToMessageId}, but it is gone now, so your own words are all I have. ${asked}`
    }

    const quoted = replyTo.quoteText ? ` You quoted ${echo(replyTo.quoteText)} out of it.` : ""

    // Only bot's own messages may have localId, if provided.
    if (replyTo.localId !== undefined) {
        return `Hi ${username}! You replied to my own message ${echo(replyTo.text)}.${quoted} ${asked}`
    }

    // A third party's message, with our tag opening the reply.
    return `Hi ${username}! So you want my opinion on what ${replyTo.username} said: ${echo(replyTo.text)}.${quoted} ${asked}`
}

bot.on("chat.addressed", (trigger) => {
    const question = withoutOpeningTag(trigger.text)

    return [
        {
            type: "chat.addMessage",
            text: describe(trigger, question),
            // We answer each message once, so the inbound ID is unique among ours.
            // This is a good workaround for our case when we want to run in Lambda
            // where multimple instances can run simultaneously, but we don't want to have a shared DB.
            // With these limitations, we can't use counters proposed in https://github.com/scribble-pub/bot-sdk/blob/main/packages/bot-sdk/README.md#local-ids-and-idempotency.
            localId: trigger.messageId,
            replyTo: {
                messageId: trigger.messageId,
                // https://github.com/scribble-pub/bot-sdk/blob/main/packages/bot-sdk/README.md#quoting-part-of-a-message
                ...quoteRange(trigger.text, question),
            },
        },
    ]
})

// Types unknown to this SDK version are dropped here.
bot.on("unsupported", (trigger) => {
    console.log(`Ignoring an unsupported trigger of type '${trigger.type}' in room '${trigger.room}'.`)
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

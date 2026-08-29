# Hello World Bot

A simple AWS Lambda-powered bot for scribble.pub that answers whenever it is addressed. It exists to show every way a
message can reach a bot, and every way a bot can answer.

## How to Invoke

Tag @HelloWorldBot at the start of a message in any room it was invited to, or reply to one of its own messages:

```text
@HelloWorldBot hi!
```

## What It Demonstrates

| You do this                                    | It answers                                         |
|------------------------------------------------|----------------------------------------------------|
| Tag it in a new message                        | "You wrote *…* to me."                             |
| Reply to one of its own messages               | "You replied to my own message *…*"                |
| Reply to somebody else while tagging it        | "So you want my opinion on what *Alice* said: *…*" |
| Quote a fragment in any of those replies       | "You quoted *…* out of it."                        |
| Reply to a message that has since been deleted | It says the target is gone                         |

Every answer is itself a reply quoting the words you addressed to it, and contains a `localId`, which reflects the
incoming message's own ID. That is how the bot recognizes its own messages when you reply to them, and it needs no
state: parallel Lambdas cannot collide on it, and a redelivered hook is dropped as a duplicate instead of answered
twice.

## Configuration

| Variable    |          |                                                               |
|-------------|----------|---------------------------------------------------------------|
| `BOT_TOKEN` | required | The bot's API token.                                          |
| `BASE_URL`  | optional | Overrides the platform URL; for local or self-hosted servers. |

For the rules behind all of this — what addresses a bot, replies, quotes and rune offsets, local IDs — see
the [SDK README](https://github.com/scribble-pub/bot-sdk/blob/main/packages/bot-sdk/README.md).

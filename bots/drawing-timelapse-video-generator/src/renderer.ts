import ScribblePubBot, {LogoImage} from "@scribble-pub/bot-sdk"
import {Canvas, CanvasRenderingContext2D} from "skia-canvas"
import {drawObject} from "./drawing.js"
import {spawn} from "child_process"
import * as fs from "node:fs/promises"
import {PutObjectCommand, S3Client} from "@aws-sdk/client-s3"

import {fileURLToPath} from "node:url"
import * as path from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const darkBg = path.join(__dirname, "assets", "dark-bg.png")
const fontFile = path.join(__dirname, "assets", "inter.ttf")

const s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1"
})
const bucketName = process.env.S3_BUCKET_NAME

const FPS = 30
const LINES_PER_FRAME = 10

const LOGO_HEIGHT = 60
const CANVAS_INPUT_HEIGHT = 1080 - 20 - LOGO_HEIGHT

const LOGO_FILE = "logo.png"

type QueueItem = {
    room: string
    userName: string
    next?: QueueItem
}

type Layer = {
    canvas: Canvas
    ctx: CanvasRenderingContext2D
}

export default class Renderer {
    private queueRoot?: QueueItem
    private queueTail?: QueueItem
    private lastSuccessTime = new Map<string, number>()

    private lastLogo?: LogoImage

    constructor(private spBot: ScribblePubBot) {
    }

    enqueueExport(room: string, userName: string): string | void {
        const lastSuccess = this.lastSuccessTime.get(room)
        if (lastSuccess && Date.now() - lastSuccess < 30 * 60 * 1000) {
            return `${userName}, you can only generate one video every 30 minutes. Please try again later.`
        }

        const newQueueItem: QueueItem = {
            room,
            userName
        }
        if (this.queueTail) {
            this.queueTail.next = newQueueItem
            this.queueTail = newQueueItem
        } else {
            this.queueRoot = newQueueItem
            this.queueTail = newQueueItem

            this.renderNext().catch(err => {
                console.error("Queue error:", err)
            })
        }
        return `${userName}, your video is being processed.`
    }

    private async renderNext(): Promise<void> {
        const next = this.queueRoot
        if (!next) return

        try {
            const videoUrl = await this.renderItem(next)
            this.lastSuccessTime.set(next.room, Date.now())
            const messageText = videoUrl 
                ? `${next.userName}, your video is ready: ${videoUrl}.\n\nNow share it on social media!`
                : `${next.userName}, your video is ready.`
            void this.spBot.sendActions(next.room, [
                {
                    type: "chat.addMessage",
                    text: messageText
                }
            ])
        } catch (err) {
            console.error("Rendering error:", err)
            void this.spBot.sendActions(next.room, [
                {
                    type: "chat.addMessage",
                    text: `${next.userName}, there's an error processing your video.`
                }
            ])
        } finally {
            this.queueRoot = next.next
            if (this.queueRoot) {
                void this.renderNext()
            } else {
                this.queueTail = undefined
            }
        }
    }

    private async renderItem(item: QueueItem): Promise<string | void> {
        const logoPromise = this.spBot.getLogoImage({
            ifNoneMatch: this.lastLogo?.etag,
            theme: "dark",
        }).then(async res => {
            if (res) {
                this.lastLogo = res
                await fs.writeFile(LOGO_FILE, Buffer.from(res.image))
            }
        })

        const scratchpad = await this.spBot.getScratchpadState(item.room)
        if (!scratchpad.sessionMeta) return

        if (scratchpad.objects.size < 1000) {
            void this.spBot.sendActions(item.room, [
                {
                    type: "chat.addMessage",
                    text: `${item.userName}, there are not enough lines in this room (less than 1000).`
                }
            ])
            return
        }

        let canvasInputWidth = Math.ceil(scratchpad.sessionMeta.canvasWidth * CANVAS_INPUT_HEIGHT / scratchpad.sessionMeta.canvasHeight)
        if (canvasInputWidth % 2 !== 0) {
            canvasInputWidth++
        }

        const layers = new Map<number, Layer>()
        scratchpad.layerOrder.forEach(layerId => {
            const layer = scratchpad.layers.get(layerId)
            if (!layer) return
            const hasLines = layer.frames.some(frameId => (scratchpad.frames.get(frameId)?.objects?.length ?? 0) > 0)
            if (!hasLines) return
            const canvas = new Canvas(canvasInputWidth, CANVAS_INPUT_HEIGHT)
            const ctx = canvas.getContext("2d")
            if (!ctx) return
            const scale = CANVAS_INPUT_HEIGHT / scratchpad.sessionMeta!.canvasHeight
            ctx.scale(scale, scale)
            layers.set(layer.layerId, {
                canvas: canvas,
                ctx: ctx,
            })
        })

        const ac = new AbortController()
        const {signal} = ac

        try {
            await logoPromise
        } catch (err) {
            console.error("Failed to fetch logo", err)
            throw err
        }

        let drawingUrl = `scribble.pub/${item.room}`
        if (scratchpad.sessionMeta.seqId) {
            drawingUrl += `/${scratchpad.sessionMeta.seqId}`
        }

        const totalHeight = CANVAS_INPUT_HEIGHT + 20 + LOGO_HEIGHT
        const ffmpeg = spawn("ffmpeg", [
            "-y",

            "-f", "rawvideo",
            "-pixel_format", "rgba",
            "-video_size", `${canvasInputWidth}x${CANVAS_INPUT_HEIGHT}`,
            "-framerate", `${FPS}`,
            "-i", "pipe:0",
            "-i", LOGO_FILE,
            "-i", darkBg,
            "-filter_complex", `
                [2:v]scale=${canvasInputWidth}:${totalHeight},setsar=1[bg_stretched];
                
                [bg_stretched][0:v]overlay=x=0:y=${20 + LOGO_HEIGHT}[bg_with_canvas];
                
                [1:v]scale=350:${LOGO_HEIGHT}:force_original_aspect_ratio=decrease[logo];
                
                [bg_with_canvas][logo]overlay=40:10[with_logo];
                
                [with_logo]drawtext=fontfile=${fontFile}: \\
                    text='${drawingUrl}': \\
                    fontcolor=white: \\
                    fontsize=32: \\
                    x=w-tw-40:y=(${20 + LOGO_HEIGHT}-th)/2+5: \\
                    shadowcolor=black@0.6:shadowx=2:shadowy=2
            `,
            "-c:v", "libx264",

            "output.mp4"
        ], {signal})
        let ffmpegErrorOutput = ""
        let processFailed = false
        ffmpeg.stdin.on("error", () => {
            // Ignore EPIPE: the exit Promise will handle it
        })

        const exitPromise = new Promise<void>((resolve, reject) => {
            ffmpeg.on("close", (code) => {
                if (code === 0) {
                    resolve()
                } else {
                    processFailed = true
                    ac.abort()
                    reject(new Error(`FFmpeg failed with code ${code}:\n${ffmpegErrorOutput.slice(-1000)}`))
                }
            })

            ffmpeg.on("error", (err) => {
                processFailed = true
                ac.abort()
                reject(err)
            })
        })
        
        exitPromise.catch(() => {})

        ffmpeg.stderr.on("data", (data) => console.log(`FFmpeg: ${data.toString()}`))

        const mergedCanvas = new Canvas(canvasInputWidth, CANVAS_INPUT_HEIGHT)
        const mergedCtx = mergedCanvas.getContext("2d")
        if (!mergedCtx) return

        async function writeFrame(buffer: Buffer) {
            if (processFailed || signal.aborted) {
                throw new Error("Cannot write frame: FFmpeg process has already exited.")
            }

            const canWrite = ffmpeg.stdin.write(buffer)
            if (!canWrite) {
                await new Promise<void>((resolve, reject) => {
                    const onDrain = () => {
                        signal.removeEventListener("abort", onAbort)
                        resolve()
                    }
                    const onAbort = () => {
                        ffmpeg.stdin.removeListener("drain", onDrain)
                        reject(new Error("Write cancelled: Process exited."))
                    }

                    ffmpeg.stdin.once("drain", onDrain)
                    signal.addEventListener("abort", onAbort, {once: true})
                })
            }
        }

        let framesSent = 0
        const mergeAndPipe = async () => {
            mergedCtx.fillStyle = "#fff"
            mergedCtx.fillRect(0, 0, canvasInputWidth, CANVAS_INPUT_HEIGHT)
            layers.forEach(layer => {
                mergedCtx.drawImage(layer.canvas, 0, 0)
            })
            const buffer = await mergedCanvas.toBuffer("raw", {colorType: "rgba"})
            await writeFrame(buffer)
            framesSent++
        }

        let itemsInBatch = 0
        for (let object of scratchpad.objects.values()) {
            if (signal.aborted) break
            const layer = scratchpad.frames.get(object.frameId)?.layerId
            if (layer === undefined) continue
            const layerCanvas = layers.get(layer)
            if (layerCanvas === undefined) continue

            switch (object.objectType) {
                case "line.floats": {
                    drawObject(layerCanvas.ctx, object)
                    break
                }
            }

            itemsInBatch++
            if (itemsInBatch >= LINES_PER_FRAME) {
                await mergeAndPipe()
                itemsInBatch = 0
            }
        }
        if (itemsInBatch > 0) {
            await mergeAndPipe()
        }
        ffmpeg.stdin.end()
        await exitPromise

        if (bucketName) {
            const dateStr = new Date().toISOString().replace(/[:.]/g, "-")
            const objectKey = `playbackbot/${item.room}-${dateStr}.mp4`
            
            console.log(`Uploading to s3://${bucketName}/${objectKey}...`)
            const fileData = await fs.readFile("output.mp4")
            
            try {
                await s3Client.send(new PutObjectCommand({
                    Bucket: bucketName,
                    Key: objectKey,
                    Body: fileData,
                    ContentType: "video/mp4"
                }))
                console.log(`Successfully uploaded to S3: s3://${bucketName}/${objectKey}`)
                
                await fs.unlink("output.mp4").catch(() => {})
                
                return `https://scribblepub-misc.s3.eu-north-1.amazonaws.com/${objectKey}`
            } catch (err) {
                console.error("Failed to upload to S3", err)
            }
        }
    }
}

import {ScratchpadObject, rgbaToHex} from "@scribble-pub/bot-sdk"
import {CanvasRenderingContext2D} from "skia-canvas"

export function drawObject(ctx: CanvasRenderingContext2D, obj: ScratchpadObject) {
    switch (obj.objectType) {
        case "line.floats": {
            if (obj.points.length < 2) {
                return
            }

            const isFilled = obj.lineWidth === 0
            const isJustCircle = obj.points.length < 4

            if (isFilled || isJustCircle) {
                ctx.fillStyle = rgbaToHex(obj.rgba)

                if (isJustCircle) {
                    ctx.beginPath()
                    ctx.arc(
                        obj.points[0],
                        obj.points[1],
                        obj.lineWidth / 2,
                        0,
                        2 * Math.PI
                    )
                    ctx.fill()
                    return
                }
            } else {
                ctx.lineWidth = obj.lineWidth
                ctx.strokeStyle = rgbaToHex(obj.rgba)
                ctx.lineJoin = "round"
                ctx.lineCap = "round"
            }
            ctx.beginPath()
            ctx.moveTo(obj.points[0], obj.points[1])
            for (let i = 3; i < obj.points.length; i += 2) {
                ctx.lineTo(obj.points[i - 1], obj.points[i])
            }
            if (isFilled) {
                ctx.fill()
            } else {
                ctx.stroke()
            }
            return
        }
    }
}

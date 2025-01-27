
import * as Utils from "./utils.js";
import {Debouncer} from "./utils.js";

const DIMENSIONS = 2;
const NUM_PARTICLES = 30000;
const DEFAULT_RANDOM_VIBRATION_INTENSITY = 2;
const MAX_GRADIENT_INTENSITY = .4;
const DEBUG_VIBRATION_LEVELS = false;
const CANVAS_SCALE = 1.5;


class Tuple {
    constructor(...args) {
        this.contents = args;
        this.length = this.contents.length;
    }
}


class ChladniApp {

    constructor () {
        this.canvas = document.createElement("canvas");
        // this.canvas.classList.add("pixelated");
        this.context = this.canvas.getContext("2d");
        document.body.appendChild(this.canvas);

        /** @type {ImageData} */
        this.imageData = null;

        /** @type {Uint32Array} */
        this.buffer = null;
        /** @type {Float32Array} */
        this.vibrationValues = null;
        /** @type {Float32Array} */
        this.gradients = null;

        this.vibrationIntensity = DEFAULT_RANDOM_VIBRATION_INTENSITY;
        this.halfVibrationIntensity = this.vibrationIntensity / 2;

        this.debugVibration = DEBUG_VIBRATION_LEVELS;
        this.isRunning = true;

        this.width = window.innerWidth / CANVAS_SCALE;
        this.height = window.innerHeight / CANVAS_SCALE;
        this.depth = Math.min(this.width, this.height);

        const debounceTimer = new Debouncer();

        // this.particles = new Float32Array(NUM_PARTICLES * DIMENSIONS);
        this.particles = new Array(NUM_PARTICLES);

        this.nonResonantColor = Utils.cssColorToColor(Utils.readCssVarAsHexNumber("non-resonant-color"));
        this.colorIndex = 0;
        this.colors = [];
        let cssColorIndex = 1;
        let cssColor;
        while (cssColor = Utils.readCssVarAsHexNumber("particle-color-" + cssColorIndex)) {
            this.colors.push(Utils.cssColorToColor(cssColor));
            cssColorIndex++;
        }
        this.selectedColor = this.colors[this.colorIndex];

        this.backgroundColor = Utils.cssColorToColor(Utils.readCssVarAsHexNumber("background-color"));

        this.fpsCount = 0;
        this.initStatus();

        this.worker = new Worker("gradient-worker.js");
        this.worker.addEventListener("message", this.onMessageFromWorker.bind(this));

        window.addEventListener("resize", () => debounceTimer.set(this.resize.bind(this), 350));
        this.resize();

        this.updateFn = this.update.bind(this);
        this.update(performance.now());

        setInterval(this.checkForFallenParticles.bind(this), 10000);

        window.addEventListener("keypress", this.keypress.bind(this));
    }

    initStatus() {
        this.fpsElem = document.getElementById("fps");
        setInterval(() => {
            this.fpsElem.innerText = this.fpsCount.toString(); this.fpsCount = 0;
        }, 1000);
    }

    keypress(event) {
        switch (event.key) {
            case "d": this.debugVibration = !this.debugVibration; break;
            case " ": this.isRunning = !this.isRunning; break;
        }
    }

    resize() {
        this.width = Math.ceil(window.innerWidth / CANVAS_SCALE);
        this.height = Math.ceil(window.innerHeight / CANVAS_SCALE);
        this.depth = Math.min(this.width, this.height);
        this.canvas.setAttribute("width", this.width);
        this.canvas.setAttribute("height", this.height);
        this.canvas.setAttribute("depth", this.depth);

        this.worker.postMessage({
            width: this.width,
            height: this.height,
            depth: this.depth,
            dimensions: DIMENSIONS
        });

        this.imageData = this.context.getImageData(0, 0, this.width, this.height);
        this.buffer = new Uint32Array(this.imageData.data.buffer);
        // recalculateGradients();
        console.info(`New buffer created (${this.width}x${this.height})`);

        // for (let i = 0; i < this.particles.length; i += 2) {
        //     this.particles[i] = Math.random() * this.width;
        //     this.particles[i + 1] = Math.random() * this.height;
        // }

        for (let i = 0; i < this.particles.length; i += 1) {
            let newPos;
            let x = Math.random() * this.width;
            let y = Math.random() * this.height;
            if (DIMENSIONS == 2) {
                newPos = new Tuple(
                    x,
                    y,
                );
            } else {
                let z = Math.random() * this.depth;
                newPos = new Tuple(
                    x,
                    y,
                    z
                );
            }
            this.particles[i] = newPos;
        }
    }

    onMessageFromWorker(message) {
        this.vibrationIntensity = message.data.vibrationIntensity;
        this.halfVibrationIntensity = this.vibrationIntensity / 2;
        this.vibrationValues = message.data.vibrationValues ? new Float32Array(message.data.vibrationValues) : null;
        this.gradients = message.data.gradients ? new Float32Array(message.data.gradients) : null;
        if (this.gradients) {
            this.colorIndex = (this.colorIndex + 1) % this.colors.length;
            this.selectedColor = this.colors[this.colorIndex];
        }
    }

    // replace sand that fell from the plate
    checkForFallenParticles() {
        const SLACK = 100;  // allow particles to really leave the screen before replacing them

        // for (let i = 0; i < this.particles.length; i += DIMENSIONS) {
        //     let x = this.particles[i];
        //     let y = this.particles[i + 1];
        // }

        for (let i = 0; i < this.particles.length; i += 1) {
            let x = this.particles[i].contents[0];
            let y = this.particles[i].contents[1];

            let didFall = x < -SLACK || x >= this.width + SLACK || y < -SLACK || y >= this.height + SLACK;
            if (DIMENSIONS > 2) {
                let z = this.particles[i].contents[2];
                didFall ||= z < -SLACK || z >= this.depth + SLACK;
            }

            if (didFall) {
                let newPos;
                if (DIMENSIONS == 2) {
                    newPos = new Tuple(
                        Math.random() * this.width,
                        Math.random() * this.height,
                    );
                } else {
                    newPos = new Tuple(
                        Math.random() * this.width,
                        Math.random() * this.height,
                        Math.random() * this.depth
                    );
                }
                this.particles[i] = newPos;
            }
        }
    }

    obtainGradientAt(x, y, z) {
        // used to lerp nearest gradient grid corners here, but it's too expensive and doesn't make any visual difference
        x = Math.round(x);
        y = Math.round(y);
        z = Math.round(z);
        let index;
        if (DIMENSIONS == 2) {
            index = (y * this.width + x) * 2;
            return [
                this.gradients[index],
                this.gradients[index + 1]
            ];
        } else if (DIMENSIONS == 3) {
            index = (z * this.width * this.height + y * this.width + x) * 3;
            return [
                this.gradients[index],
                this.gradients[index + 1],
                this.gradients[index + 2]
            ];
        }
    }

    update() {
        if (!this.isRunning) {
            this.fpsCount++;
            requestAnimationFrame(this.updateFn);
            return;
        }

        if (this.debugVibration && this.vibrationValues) {
            const MAX_LUMINOSITY = 64;  // up to 256
            for (let i = 0; i < this.vibrationValues.length; i++) {
                const intensity = this.vibrationValues[i] * MAX_LUMINOSITY;
                this.buffer[i] = Utils.rgbToVal(intensity, intensity, intensity);
            }
        } else {
            this.buffer.fill(this.backgroundColor);
        }

        const color = this.gradients ? this.selectedColor : this.nonResonantColor;

        // for (let i = 0; i < this.particles.length; i += 2) {
        //     let x = this.particles[i];
        //     let y = this.particles[i + 1];

        //     if (this.gradients) {
        //         const [gradX, gradY] = this.obtainGradientAt(x, y);

        //         // descend gradient
        //         x += MAX_GRADIENT_INTENSITY * gradX;
        //         y += MAX_GRADIENT_INTENSITY * gradY;
        //     }

        //     // random vibration
        //     x += Math.random() * this.vibrationIntensity - this.halfVibrationIntensity;
        //     y += Math.random() * this.vibrationIntensity - this.halfVibrationIntensity;

        //     this.particles[i] = x;
        //     this.particles[i + 1] = y;

        //     this.buffer[Math.round(y) * this.width + Math.round(x)] = color;
        // }

        for (let i = 0; i < this.particles.length; i += 1) {
            let particle = this.particles[i];
            let x = this.particles[i].contents[0];
            let y = this.particles[i].contents[1];
            // console.log(particle);

            if (this.gradients) {
                if (DIMENSIONS == 2) {
                    let [gradX, gradY] = this.obtainGradientAt(x, y, 0);

                    // descend gradient
                    x += MAX_GRADIENT_INTENSITY * gradX;
                    y += MAX_GRADIENT_INTENSITY * gradY;
                } else {
                    let z = this.particles[i].contents[2];
                    let [gradX, gradY, gradZ] = this.obtainGradientAt(x, y, z);

                    // descend gradient
                    x += MAX_GRADIENT_INTENSITY * gradX;
                    y += MAX_GRADIENT_INTENSITY * gradY;
                    z += MAX_GRADIENT_INTENSITY * gradZ;
                }
            }

            // random vibration
            x += Math.random() * this.vibrationIntensity - this.halfVibrationIntensity;
            y += Math.random() * this.vibrationIntensity - this.halfVibrationIntensity;

            this.particles[i].contents[0] = x;
            this.particles[i].contents[1] = y;

            if (DIMENSIONS > 2) {
                z += Math.random() * this.vibrationIntensity - this.halfVibrationIntensity;
                this.particles[i].contents[2] = z;
            }

            this.buffer[Math.round(y) * this.width + Math.round(x)] = color;
        }

        this.context.putImageData(this.imageData, 0, 0);

        this.fpsCount++;
        requestAnimationFrame(this.updateFn);
    }
}

new ChladniApp();

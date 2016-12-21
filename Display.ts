import { Clock } from './Clock';
import { Memory, LY, LYC, LCDC, STAT } from './Memory';

type ModeToBits = {
  hBlank: 0,
  vBlank: 1,
  searching: 2,
  transferring: 3,
};
type Mode = keyof ModeToBits;

const SCREEN_X = 160;
const SCREEN_Y = 144;
const SEARCHING_TIME = 80;
const HBLANK_TIME = 204;
const VBLANK_TIME = 4560;
const TRANSFERING_TIME = 172;
const MODE_TO_BITS: ModeToBits = {
  hBlank: 0,
  vBlank: 1,
  searching: 2,
  transferring: 3,
};
const STAT_COINCIDENCE_ENABLE_MASK = 0x40;
const STAT_OAM_INTERRUPT_ENABLE_MASK = 0x20;
const STAT_VBLANK_INTERRUPT_ENABLE_MASK = 0x10;
const STAT_HBLANK_INTERRUPT_ENABLE_MASK = 0x8;
const STAT_COINCIDENCE_FLAG_MASK = 0x4;
const DISPLAY_ENABLE_MASK = 0x80;

export class Display {
  _clock: Clock;
  _memory: Memory;
  _canvasContext: CanvasRenderingContext2D;
  _buffer: Uint8ClampedArray;
  _mode: Mode;
  _displayEnabled: boolean;

  constructor(clock: Clock, memory: Memory) {
    this._clock = clock;
    this._memory = memory;
    this._buffer = new Uint8ClampedArray(SCREEN_X * SCREEN_Y);
    this._canvasContext = this._createCanvas();
    this._displayEnabled = true;
    this._handleMode('searching');
  }

  _handleMode(mode: Mode): void {
    const displayEnable = Boolean(this._memory.read(LCDC) & DISPLAY_ENABLE_MASK);
    if (!displayEnable) {
      // If the display has been turned off then we will just exit here and no more display jobs
      // will be scheuled.  We watch writes to this LCDC register to know when to re-schedule jobs
      // when the bit has been set again.
      this._displayEnabled = false;
      this._memory.watch(LCDC, this._onLcdcWrite.bind(this));
      return;
    }
    switch (mode) {
      case 'searching': {
        this._memory.write(LY, 0);
        this._clock.schedule(SEARCHING_TIME, () => this._handleMode('transferring'));
        break;
      }
      case 'transferring': {
        this._readLine();
        this._clock.schedule(TRANSFERING_TIME, () => this._handleMode('hBlank'));
        break;
      }
      case 'hBlank': {
        // NOTE: valid values for LY also include 145-153, but these are never attained in this
        // implementation.
        const ly = this._memory.read(LY);
        this._memory.write(LY, ly + 1);
        this._clock.schedule(
          HBLANK_TIME,
          () => this._handleMode(ly + 1 === SCREEN_Y ? 'vBlank' : 'searching'),
        );
        break;
      }
      case 'vBlank': {
        this._memory.requestInterrupt('vBlank');
        this._clock.schedule(VBLANK_TIME, () => this._handleMode('searching'));
        this._draw();
        break;
      }
      default: throw new Error(`unrecognized mode: ${mode}`);
    }
    this._setStatFlags(mode);
    this._requestInterrupt(mode);
  }

  _onLcdcWrite(val: number): void {
    const displayEnable = Boolean(val & DISPLAY_ENABLE_MASK);
    if (displayEnable && !this._displayEnabled) {
      this._displayEnabled = true;
      this._handleMode('searching');
    }
  }

  _requestInterrupt(mode: Mode): void {
    const stat = this._memory.read(STAT);
    const coincidenceEnable = Boolean(stat & STAT_COINCIDENCE_ENABLE_MASK);
    const coincidenceFlag = Boolean(stat & STAT_COINCIDENCE_FLAG_MASK);
    const oamEnabled = Boolean(stat & STAT_OAM_INTERRUPT_ENABLE_MASK);
    const vBlankEnabled = Boolean(stat & STAT_VBLANK_INTERRUPT_ENABLE_MASK);
    const hBlankEnabled = Boolean(stat & STAT_HBLANK_INTERRUPT_ENABLE_MASK);
    if (
      coincidenceFlag && coincidenceEnable
      || mode === 'vBlank' && vBlankEnabled
      || mode === 'hBlank' && hBlankEnabled
      || mode === 'searching' && oamEnabled
    ) {
      this._memory.requestInterrupt('lcdStat');
    }
  }

  _setStatFlags(mode: Mode): void {
    const stat = this._memory.read(STAT);
    const newStat = stat & (~0x7);
    const coincidence = this._memory.read(LY) === this._memory.read(LYC)
      ? STAT_COINCIDENCE_FLAG_MASK
      : 0x0;
    const flags = coincidence + MODE_TO_BITS[mode];
    this._memory.write(STAT, newStat | flags);
  }

  _createCanvas(): CanvasRenderingContext2D {
    const body = document.querySelector('body') as HTMLElement;
    const screen = document.createElement('canvas');
    screen.width = SCREEN_X;
    screen.height = SCREEN_Y;
    body.appendChild(screen);
    return screen.getContext('2d') as CanvasRenderingContext2D;
  }

  _draw(): void {
    const imageData = new ImageData(this._buffer, SCREEN_X, SCREEN_Y);
    this._canvasContext.putImageData(imageData, 0, 0);
  }

  _drawRow(): void {
    const data: number[] = [];
    for (let y = 0; y < SCREEN_Y; y++) {
      for (let x = 0; x < SCREEN_X; x++) {
        data.push(Math.floor(Math.random() * 0xFF)); // R
        data.push(Math.floor(Math.random() * 0xFF)); // G
        data.push(Math.floor(Math.random() * 0xFF)); // B
        data.push(Math.floor(Math.random() * 0xFF)); // A
      }
    }
  }
}
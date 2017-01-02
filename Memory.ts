import { MemoryController } from './MemoryController';
import { Mbc3 } from './Mbc3';
import { Clock } from './Clock';
import { CLOCK_SPEED } from './Cpu';
import { decToHex } from './common';

type InterruptName = 'vBlank' | 'lcdStat' | 'timer' | 'serial' | 'joypad';
type InterruptVector = 0x40 | 0x48 | 0x50 | 0x58 | 0x60;

export interface Interrupt {
  name: InterruptName;
  vector: InterruptVector;
  requested: boolean;
  enabled: boolean;
}

type InterruptInfo = {
[I in InterruptName]: Interrupt;
};

export interface Color {
  red: number;
  green: number;
  blue: number;
}

const DIV_FREQ = 16384;
const INTERRUPT_NAMES: InterruptName[] = ['vBlank', 'lcdStat', 'timer', 'serial', 'joypad'];

const INTERRUPT_ENABLE_REG = 0xFFFF;
const INTERRUPT_REQUEST_REG = 0xFF0F;
const SB = 0xFF01;
const SC = 0xFF02;
const DIV = 0xFF04;
const TIMA = 0xFF05;
const TMA = 0xFF06;
const TAC = 0xFF07;
const NR10 = 0xFF10;
const NR11 = 0xFF11;
const NR12 = 0xFF12;
const NR14 = 0xFF14;
const NR21 = 0xFF16;
const NR22 = 0xFF17;
const NR24 = 0xFF19;
const NR30 = 0xFF1A;
const NR31 = 0xFF1B;
const NR32 = 0xFF1C;
const NR33 = 0xFF1E;
const NR41 = 0xFF20;
const NR42 = 0xFF21;
const NR43 = 0xFF22;
const NR44 = 0xFF23;
const NR50 = 0xFF24;
const NR51 = 0xFF25;
const NR52 = 0xFF26;
export const LCDC = 0xFF40;
export const STAT = 0xFF41;
export const SCY = 0xFF42;
export const SCX = 0xFF43;
export const LY = 0xFF44;
export const LYC = 0xFF45;
const BGP = 0xFF47;
const OBP0 = 0xFF48;
const OBP1 = 0xFF49;
const WY = 0xFF4A;
const WX = 0xFF4B;
const VBK = 0xFF4F;
const BGPI = 0xFF68;
const BGPD = 0xFF69;
const OBPI = 0xFF6A;
const OBPD = 0xFF6B;
const SVBK = 0xFF70;
const IE = 0xFFFF;

export class Memory {
  _romBank0: Uint8Array;
  _rom: Uint8Array;
  _controller: MemoryController;
  _clock: Clock;
  _watches: Map<number, ((arg: number) => void)[]>;
  _bgPalette: Uint8Array;
  _spritePalette: Uint8Array;
  _vramBanks: [Uint8Array, Uint8Array];
  _hram: Uint8Array;
  _wramBank0: Uint8Array;
  _wramBanks: Uint8Array[];

  constructor(rom: Buffer, clock: Clock) {
    this._clock = clock;
    this._rom = Uint8Array.from(rom);
    this._romBank0 = new Uint8Array(0x4000);
    this._watches = new Map();
    this._wramBank0 = new Uint8Array(0x1000);
    this._wramBanks = [];
    for (let i = 0; i < 7; i++) {
      this._wramBanks[i] = new Uint8Array(0x1000);
    }
    // TODO: These may not be initialized correctly.
    this._bgPalette = new Uint8Array(0x40);
    this._spritePalette = new Uint8Array(0x40);
    this._vramBanks = [new Uint8Array(0x2000), new Uint8Array(0x2000)];
    // TODO use the header to choose a memory controller at runtime.
    this._controller = new Mbc3();
    this._hram = new Uint8Array(0x100);
    for (let i = 0; i < 0x4000; i++) {
      this._romBank0[i] = this._rom[i];
    }
    this._initialize();
    this._scheduleTimers();
  }

  write(addr: number, data: number): void {
    if (data >> 8) {
      throw new Error(`Writing data bigger than a byte: ${data}`);
    }
    if (0x0 <= addr && addr < 0x2000) {
      this._controller.enableRam(data);
    } else if (0x2000 <= addr && addr < 0x4000) {
      this._controller.selectRomBank(data);
    } else if (0x4000 <= addr && addr < 0x6000) {
      this._controller.selectRamBank(data);
    } else if (0x6000 <= addr && addr < 0x8000) {
      this._controller.latchClockData(data);
    } else if (0x8000 <= addr && addr < 0xA000) {
      this._writeVram(addr, data);
    } else if (0xC000 <= addr && addr < 0xD000) {
      this._wramBank0[addr - 0xC000] = data;
    } else if (0xD000 <= addr && addr < 0xE000) {
      this._writeWram(addr, data);
    } else if (0xFF00 <= addr && addr < 0x10000) {
      if (addr === BGPD) {
        this._writeBgpd(data);
      } else if (addr === OBPD) {
        this._writeObpd(data);
      } else if (addr === SB || addr === SC) {
        // TODO: figure out a story for the link cable stuff.
        this._writeHram(addr, data);
      } else if (addr === TIMA || addr === TMA || addr === DIV || addr === TAC) {
        this._writeHram(addr, data);
      } else if (addr === WX || addr === WY) {
        // TODO: figure out a window story
        this._writeHram(addr, data);
      } else if (addr === LY) {
        this._writeHram(addr, 0x0);
      } else if (addr === LCDC || addr === STAT || addr === SCX || addr === SCY || addr === LYC) {
        this._writeHram(addr, data);
      } else if (addr === BGP || addr === OBP0 || addr === OBP1) {
        this._writeHram(addr, data);
      } else if (0xFF80 <= addr && addr < 0x10000) {
        this._writeHram(addr, data);
      } else {
        throw new Error(`unsupported write of ${data} at: ${decToHex(addr)}`);
      }
    } else {
      throw new Error(`unsupported write of ${data} at: ${decToHex(addr)}`);
    }
    const watches = this._watches.get(addr);
    if (watches != null) {
      watches.forEach(watch => watch(data));
    }
  }

  read(addr: number): number {
    if (0x0 <= addr && addr < 0x4000) {
      return this._romBank0[addr];
    } else if (0x4000 <= addr && addr < 0x8000) {
      throw new Error(`Reading unsupported address: ${addr}`);
    } else if (0x8000 <= addr && addr < 0xA000) {
      return this._readVram(addr);
    } else if (0xC000 <= addr && addr < 0xD000) {
      return this._wramBank0[addr - 0xC000];
    } else if (0xD000 <= addr && addr < 0xE000) {
      return this._readWram(addr);
    } else if (0xFF00 <= addr && addr < 0x10000) {
      if (addr === OBPD) {
        return this._readObpd();
      } else if (addr === BGPD) {
        return this._readBgpd();
      } else if (addr === LCDC || addr === STAT || addr === LY || addr === LYC) {
        return this._readHram(addr);
      } else if (addr === INTERRUPT_REQUEST_REG) {
        return this._readHram(addr);
      } else if (addr === TIMA || addr === TMA || addr === DIV || addr === TAC) {
        return this._readHram(addr);
      } else if (addr === BGP || addr === OBP0 || addr === OBP1) {
        return this._readHram(addr);
      } else if (0xFF80 <= addr && addr < 0x10000) {
        return this._readHram(addr);
      } else {
        throw new Error(`Reading unsupported address: ${decToHex(addr)}`);
      }
    } else {
      throw new Error(`Reading unsupported address: ${decToHex(addr)}`);
    }
  }

  _writeWram(addr: number, data: number): void {
    const svbk = (this._readHram(SVBK) & 0x7);
    if (svbk === 0) {
      this._wramBanks[1][addr - 0xD000] = data;
    } else {
      this._wramBanks[svbk][addr - 0xD000] = data;
    }
  }

  _readWram(addr: number): number {
    const svbk = (this._readHram(SVBK) & 0x7);
    if (svbk === 0) {
      return this._wramBanks[1][addr - 0xD000];
    } else {
      return this._wramBanks[svbk][addr - 0xD000];
    }
  }

  _writeHram(addr: number, data: number): void {
    this._hram[addr - 0xFF00] = data;
  }
  _readHram(addr: number): number {
    return this._hram[addr - 0xFF00];
  }

  getBgPaletteColors(index: number): Color[] {
    // 8 bytes define Color 0-3 of the Palette.
    const result: Color[] = [];
    for (let i = 0; i < 4; i += 2) {
      // TODO little or big endian?
      const byte0 = this._bgPalette[index * 8 + i];
      const byte1 = this._bgPalette[index * 8 + i + 1];
      let word = (byte1 << 8) + byte0;
      const red = word & 0x1F;
      word = word >> 5;
      const green = word & 0x1F;
      word = word >> 5;
      const blue = word & 0x1F;
      result.push({ red, green, blue });
    }
    return result;
  }

  readVram0(addr: number): number {
    return this._vramBanks[0][addr];
  }

  readVram1(addr: number): number {
    return this._vramBanks[1][addr];
  }

  _writeVram(addr: number, data: number): void {
    this._vramBanks[this._getVramBank()][addr - 0x8000] = data;
  }

  _readVram(addr: number): number {
    return this._vramBanks[this._getVramBank()][addr - 0x8000];
  }

  _getVramBank(): number {
    return this._romBank0[VBK] & 0x1;
  }

  _readBgpd(): number {
    return this._readPaletteData(BGPI, this._bgPalette);
  }

  _readObpd(): number {
    return this._readPaletteData(OBPI, this._spritePalette);
  }

  _readPaletteData(indexReg: number, palette: Uint8Array): number {
    const paletteIndex = this._romBank0[indexReg];
    const index = paletteIndex & 0x3F;
    return palette[index];
  }

  _writeObpd(val: number): void {
    this._writePaletteData(val, OBPI, this._spritePalette);
  }

  _writeBgpd(val: number): void {
    this._writePaletteData(val, BGPI, this._bgPalette);
  }

  _writePaletteData(val: number, indexReg: number, palette: Uint8Array): void {
    const paletteIndex = this._romBank0[indexReg];
    palette[paletteIndex] = val;
    const shouldIncrement = Boolean(this._romBank0[indexReg] & 0x80);
    if (shouldIncrement) {
      // NOTE: this can overflow if the programmer doesn't manually reset it.
      this._romBank0[indexReg]++;
    }
  }

  watch(addr: number, cb: (val: number) => void): void {
    const watches = this._watches.get(addr);
    if (watches == null) {
      this._watches.set(addr, [cb]);
    } else {
      watches.push(cb);
    }
  }

  getInterruptInfo(): InterruptInfo {
    const enableReg = this.read(INTERRUPT_ENABLE_REG);
    const requestReg = this.read(INTERRUPT_REQUEST_REG);
    const result: Partial<InterruptInfo> = {};
    INTERRUPT_NAMES.forEach(name => {
      result[name] = this._getInterrupt(name, requestReg, enableReg);
    });
    return result as InterruptInfo;
  }

  _getInterrupt(name: InterruptName, requestReg: number, enableReg: number): Interrupt {
    const mask = getMaskFromInterrupt(name);
    return {
      name,
      vector: getVectorFromInterrupt(name),
      requested: Boolean(requestReg & mask),
      enabled: Boolean(enableReg & mask),
    };
  }

  unrequestInterrupt(interrupt: InterruptName): void {
    const interruptRequestReg = this.read(INTERRUPT_REQUEST_REG);
    const mask = getMaskFromInterrupt(interrupt);
    // `mask` is the only bit we want to un-set.
    this.write(INTERRUPT_REQUEST_REG, interruptRequestReg & ~mask);
  }

  requestInterrupt(interrupt: InterruptName): void {
    const interruptRequestReg = this.read(INTERRUPT_REQUEST_REG);
    const mask = getMaskFromInterrupt(interrupt);
    this.write(INTERRUPT_REQUEST_REG, interruptRequestReg | mask);
  }

  // Timer and divider registers - TODO pull these out into own file.
  _scheduleTimers(): void {
    this._clock.schedule(hzToCycles(DIV_FREQ), () => this._incrementDiv());
    this._clock.schedule(hzToCycles(this._getTimerFrequency()), () => this._incrementTima());
  }

  _incrementDiv(): void {
    const time = this.read(DIV);
    this.write(DIV, (time + 1) % 0x100);
    this._clock.schedule(hzToCycles(DIV_FREQ), () => this._incrementDiv());
  }

  _incrementTima(): void {
    const timerEnable = Boolean(this.read(TAC) & 0x4);
    if (timerEnable) {
      const time = this.read(TIMA);
      this.write(TIMA, (time + 1) % 0x100);
      if (this.read(TIMA) === 0) {
        this.write(TIMA, this.read(TMA));
        this.requestInterrupt('timer');
      }
    }
    const updateFreq = this._getTimerFrequency();
    this._clock.schedule(hzToCycles(updateFreq), () => this._incrementTima());
  }

  _getTimerFrequency(): number {
    const tac = this.read(TAC) & 0x3;
    switch (tac) {
      case 0x0: return 4096;
      case 0x1: return 262144;
      case 0x2: return 65536;
      case 0x3: return 16384;
      default: throw new Error(`Invalid TAC value: ${tac}`);
    }
  }

  _initialize(): void {
    this._writeHram(TIMA, 0x00);
    this._writeHram(TMA, 0x00);
    this._writeHram(TAC, 0x00);
    this._writeHram(NR10, 0x80);
    this._writeHram(NR11, 0xBF);
    this._writeHram(NR12, 0xF3);
    this._writeHram(NR14, 0xBF);
    this._writeHram(NR21, 0x3F);
    this._writeHram(NR22, 0x00);
    this._writeHram(NR24, 0xBF);
    this._writeHram(NR30, 0x7F);
    this._writeHram(NR31, 0xFF);
    this._writeHram(NR32, 0x9F);
    this._writeHram(NR33, 0xBF);
    this._writeHram(NR41, 0xFF);
    this._writeHram(NR42, 0x00);
    this._writeHram(NR43, 0x00);
    this._writeHram(NR44, 0xBF);
    this._writeHram(NR50, 0x77);
    this._writeHram(NR51, 0xF3);
    this._writeHram(NR52, 0xF1);
    this._writeHram(STAT, 0x91);
    this._writeHram(SCY, 0x00);
    this._writeHram(SCX, 0x00);
    this._writeHram(LYC, 0x00);
    this._writeHram(BGP, 0xFC);
    this._writeHram(OBP0, 0xFF);
    this._writeHram(OBP1, 0xFF);
    this._writeHram(WY, 0x00);
    this._writeHram(WX, 0x00);
    this._writeHram(IE, 0x00);
  }
}

function getMaskFromInterrupt(interrupt: InterruptName): number {
  switch (interrupt) {
    case 'vBlank': return 0x1;
    case 'lcdStat': return 0x2;
    case 'timer': return 0x4;
    case 'serial': return 0x8;
    case 'joypad': return 0x10;
    default: throw new Error(`Un-requested invalid interrupt: ${interrupt}`);
  }
}

function getVectorFromInterrupt(interrupt: InterruptName): InterruptVector {
  switch (interrupt) {
    case 'vBlank': return 0x40;
    case 'lcdStat': return 0x48;
    case 'timer': return 0x50;
    case 'serial': return 0x58;
    case 'joypad': return 0x60;
    default: throw new Error(`No vector for invalid interrupt: ${interrupt}`);
  }
}

function hzToCycles(hz: number): number {
  return Math.round(CLOCK_SPEED / hz);
}

import { MemoryController } from './MemoryController';
import { Mbc3 } from './Mbc3';
import { Clock } from './Clock';
import { CLOCK_SPEED } from './Cpu';

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

const DIV_FREQ = 16384;
const INTERRUPT_NAMES: InterruptName[] = ['vBlank', 'lcdStat', 'timer', 'serial', 'joypad'];

const INTERRUPT_ENABLE_REG = 0xFFFF;
const INTERRUPT_REQUEST_REG = 0xFF0F;
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
const LCDC = 0xFF40;
const SCY = 0xFF42;
const SCX = 0xFF43;
const LYC = 0xFF45;
const BGP = 0xFF47;
const OBP0 = 0xFF48;
const OBP1 = 0xFF49;
const WY = 0xFF4A;
const WX = 0xFF4B;
const IE = 0xFFFF;

export class Memory {
  _memory: Uint8Array;
  _rom: Uint8Array;
  _controller: MemoryController;
  _clock: Clock;

  constructor(rom: Buffer, clock: Clock) {
    this._clock = clock;
    this._rom = Uint8Array.from(rom);
    this._memory = new Uint8Array(0x10000);
    // TODO use the header to choose a memory controller at runtime.
    this._controller = new Mbc3();
    for (let i = 0; i < 0x4000; i++) {
      this._memory[i] = this._rom[i];
    }
    this._initialize();
    this._scheduleTimers();
  }

  write(addr: number, data: number): void {
    if (0x0 <= addr && addr < 0x2000) {
      this._controller.enableRam(data);
    } else if (0x2000 <= addr && addr < 0x4000) {
      this._controller.selectRomBank(data);
    } else if (0x4000 <= addr && addr < 0x6000) {
      this._controller.selectRamBank(data);
    } else if (0x6000 <= addr && addr < 0x8000) {
      this._controller.latchClockData(data);
    } else if (addr === DIV) {
      this._memory[DIV] = 0x0;
    } else {
      this._memory[addr] = data;
    }
  }

  read(addr: number): number {
    if (0x0 <= addr && addr < 0x4000) {
      return this._memory[addr];
    }
    throw new Error(`Reading unsupported address: ${addr}`);
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
    const time = this._memory[DIV];
    this._memory[DIV] = (time + 1) % 0x100;
    this._clock.schedule(hzToCycles(DIV_FREQ), () => this._incrementDiv());
  }

  _incrementTima(): void {
    const timerEnable = Boolean(this._memory[TAC] & 0x4);
    if (timerEnable) {
      const time = this._memory[TIMA];
      this._memory[TIMA] = (time + 1) % 0x100;
      if (this._memory[TIMA] === 0) {
        this._memory[TIMA] = this._memory[TMA];
        this.requestInterrupt('timer');
      }
    }
    const updateFreq = this._getTimerFrequency();
    this._clock.schedule(hzToCycles(updateFreq), () => this._incrementTima());
  }

  _getTimerFrequency(): number {
    const tac = this._memory[TAC] & 0x3;
    switch (tac) {
      case 0x0: return 4096;
      case 0x1: return 262144;
      case 0x2: return 65536;
      case 0x3: return 16384;
      default: throw new Error(`Invalid TAC value: ${tac}`);
    }
  }

  _initialize(): void {
    this.write(TIMA, 0x00);
    this.write(TMA, 0x00);
    this.write(TAC, 0x00);
    this.write(NR10, 0x80);
    this.write(NR11, 0xBF);
    this.write(NR12, 0xF3);
    this.write(NR14, 0xBF);
    this.write(NR21, 0x3F);
    this.write(NR22, 0x00);
    this.write(NR24, 0xBF);
    this.write(NR30, 0x7F);
    this.write(NR31, 0xFF);
    this.write(NR32, 0x9F);
    this.write(NR33, 0xBF);
    this.write(NR41, 0xFF);
    this.write(NR42, 0x00);
    this.write(NR43, 0x00);
    this.write(NR44, 0xBF);
    this.write(NR50, 0x77);
    this.write(NR51, 0xF3);
    this.write(NR52, 0xF1);
    this.write(LCDC, 0x91);
    this.write(SCY, 0x00);
    this.write(SCX, 0x00);
    this.write(LYC, 0x00);
    this.write(BGP, 0xFC);
    this.write(OBP0, 0xFF);
    this.write(OBP1, 0xFF);
    this.write(WY, 0x00);
    this.write(WX, 0x00);
    this.write(IE, 0x00);
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
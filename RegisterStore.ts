type Flag = 'zero' | 'carry' | 'n' | 'h';
type FlagInfo = {
  [P in Flag]: boolean;
};

const [AF, BC, DE, HL, SP, PC] = [0, 1, 2, 3, 4, 5];
const LO_8 = 255;
const HI_8 = ~255;
const ZERO_MASK = 0x80;
const N_MASK = 0x40;
const H_MASK = 0x20;
const CARRY_MASK = 0x10;

export class RegisterStore {
  _regs: number[];

  constructor() {
    const regs: number[] = [];
    regs[AF] = 0x11B0; // `A` starts at 11h indicating CGB.
    regs[BC] = 0x0013;
    regs[DE] = 0x00D8;
    regs[HL] = 0x014D;
    regs[SP] = 0xFFFE;
    regs[PC] = 0x100;
    this._regs = regs;
  }

  _incr(regIndex: number): void {
    const incr = this._regs[regIndex] + 1;
    if (incr === 0x10000) {
      this._regs[regIndex] = 0;
    } else {
      this._regs[regIndex] = incr;
    }
  }

  _incrLo(): void {
    throw new Error('not implemented');
  }

  _incrHi(regIndex: number): void {
    const value = this._regs[regIndex];
    const lo8 = value & LO_8;
    const hi8 = value & HI_8;
    const incr = hi8 + 1;
    if (incr === 256) {
      // TODO: Set Z flag and others if needed.
      this._regs[regIndex] = lo8;
    } else {
      this._regs[regIndex] = incr + lo8;
    }
  }

  getA(): number {
    return this._regs[AF] & HI_8;
  }
  
  getF(): number {
    return this._regs[AF] & LO_8;
  }
  
  getB(): number {
    return this._regs[BC] & HI_8;
  }

  getBc(): number {
    return this._regs[BC];
  }

  getPc(): number {
    return this._regs[PC];
  }

  setPc(word: number): void {
    this._regs[PC] = word;
  }

  setA(byte: number): void {
    this._regs[AF] = (byte << 8) + (this._regs[AF] & LO_8);
  }

  setBc(word: number): void {
    this._regs[BC] = word;
  }

  setDe(word: number): void {
    this._regs[DE] = word;
  }

  incrA(): void {
    this._incrHi(AF);
  }

  incrBc(): void {
    this._incr(BC);
  }

  incrPc(): void {
    this._incr(PC);
  }

  getFlagInfo(): FlagInfo {
    const flags = this.getF();
    return {
      zero: Boolean(flags & ZERO_MASK),
      carry: Boolean(flags & CARRY_MASK),
      n: Boolean(flags & N_MASK),
      h: Boolean(flags & H_MASK),
    };
  }
}
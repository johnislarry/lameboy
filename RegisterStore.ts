import {Memory} from './Memory';

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
  _memory: Memory;

  constructor(memory: Memory) {
    const regs: number[] = [];
    regs[AF] = 0x11B0; // `A` starts at 11h indicating CGB.
    regs[BC] = 0x0013;
    regs[DE] = 0x00D8;
    regs[HL] = 0x014D;
    regs[SP] = 0xFFFE;
    regs[PC] = 0x100;
    this._regs = regs;
    this._memory = memory;
  }

  _incr(regIndex: number): void {
    const incr = this._regs[regIndex] + 1;
    if (!Number.isInteger(incr)) {
      debugger;
    }
    if (incr === 0x10000) {
      this._regs[regIndex] = 0;
    } else {
      this._regs[regIndex] = incr;
    }
  }

  _decr(regIndex: number): void {
    const decr = this._regs[regIndex] - 1;
    if (!Number.isInteger(decr)) {
      debugger;
    }
    if (decr === -0x1) {
      this._regs[regIndex] = 0xFFFF;
    } else {
      this._regs[regIndex] = decr;
    }
  }

  _incrLo(regIndex: number): void {
    this._incr8(regIndex, false);
  }

  _incrHi(regIndex: number): void {
    this._incr8(regIndex, true);
  }

  _decrLo(regIndex: number): void {
    this._decr8(regIndex, false);
  }

  _decrHi(regIndex: number): void {
    this._decr8(regIndex, true);
  }

  _decr8(regIndex: number, hi: boolean): void {
    let flags = this.getF() & CARRY_MASK;
    flags |= N_MASK;
    const value = this._regs[regIndex];
    if (!Number.isInteger(value)) {
      debugger;
    }
    const lo8 = value & LO_8;
    const hi8 = value & HI_8;
    let decr = hi ? hi8 - 1 : lo8 - 1;
    if (decr === -1) {
      flags |= H_MASK;
      decr = 0xFF;
    }
    if (decr === 0) {
      flags |= ZERO_MASK;
      this._regs[regIndex] = hi ? lo8 : hi8 << 8;
    } else {
      this._regs[regIndex] = hi ? (decr << 8) + lo8 : (hi8 << 8) + decr;
    }
    this.setF(flags);
  }

  _incr8(regIndex: number, hi: boolean): void {
    let flags = this.getF() & CARRY_MASK;
    const value = this._regs[regIndex];
    if (!Number.isInteger(value)) {
      debugger;
    }
    const lo8 = value & LO_8;
    const hi8 = value & HI_8;
    const incr = hi ? hi8 + 1 : lo8 + 1;
    if (incr === 0x10) {
      flags |= H_MASK;
    }
    if (incr === 256) {
      flags |= ZERO_MASK;
      this._regs[regIndex] = hi ? lo8 : hi8 << 8;
    } else {
      this._regs[regIndex] = hi ? (incr << 8) + lo8 : (hi8 << 8) + incr;
    }
    this.setF(flags);
  }

  _push(regIndex: number): void { 
    const value = this._regs[regIndex];
    if (!Number.isInteger(value)) {
      debugger;
    }
    this.decrSp();
    this._memory.write(this.getSp(), value & HI_8);
    this.decrSp();
    this._memory.write(this.getSp(), value & LO_8);
  }

  _pop(regIndex: number): void {
    const lo = this._memory.read(this.getSp());
    this.incrSp();
    const hi = this._memory.read(this.getSp());
    this.incrSp();
    this._regs[regIndex] = (hi << 8) + lo;
    if (!Number.isInteger(this._regs[regIndex])) {
      debugger;
    }
  }

  add(val: number): number {
    let flags = 0x0;
    const rawSum = this.getA() + val;
    if (rawSum > 0xFF) {
      flags |= CARRY_MASK;
    }
    const sum = rawSum % 0x100;
    if (sum === 0) {
      flags |= ZERO_MASK;
    }
    if (Boolean(((this.getA() & 0xF) + (val & 0xF)) & 0x10)) {
      flags |= H_MASK;
    }
    this.setF(flags);
    return sum;
  }

  sub(val: number): number {
    let flags = N_MASK;
    const a = this.getA();
    let difference = a - val;
    if (difference < 0) {
      flags |= CARRY_MASK;
      difference += 0x100;
    }
    if (difference === 0) {
      flags |= ZERO_MASK;
    }
    if ((a & 0xF) - (val & 0xF) < 0) {
      flags |= H_MASK;
    }
    this.setF(flags);
    return difference;
  }

  cp(value: number): void {
    this.sub(value);
  }

  and(value: number): number {
    const and = this.getA() & value;
    let flags = H_MASK;
    if (and === 0) {
      flags |= ZERO_MASK;
    }
    this.setF(flags);
    return and;
  }

  xor(value: number): number {
    let flags = 0x0;
    const xor = value ^ this.getA();
    if (xor === 0) {
      flags |= ZERO_MASK;
    }
    this.setF(flags);
    return xor;
  }

  cpB(): void {
    this.cp(this.getB());
  }

  popAf(): void {
    this._pop(AF);
  }

  popBc(): void {
    this._pop(BC);
  }

  popDe(): void {
    this._pop(DE);
  }

  popHl(): void {
    this._pop(HL);
  }

  popPc(): void {
    this._pop(PC);
  }

  pushBc(): void {
    this._push(BC);
  }

  pushDe(): void {
    this._push(DE);
  }

  pushHl(): void {
    this._push(HL);
  }

  pushPc(): void {
    this._push(PC);
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

  getC(): number {
    return this._regs[BC] & LO_8;
  }

  getD(): number {
    return this._regs[DE] & HI_8;
  }

  getE(): number {
    return this._regs[DE] & LO_8;
  }

  getH(): number {
    return this._regs[HL] & HI_8;
  }

  getL(): number {
    return this._regs[HL] & LO_8;
  }

  getBc(): number {
    return this._regs[BC];
  }

  getPc(): number {
    return this._regs[PC];
  }

  getSp(): number {
    return this._regs[SP];
  }

  getDe(): number {
    return this._regs[DE];
  }

  getHl(): number {
    return this._regs[HL];
  }

  _setLo(byte: number, regIndex: number): void {
    this._regs[regIndex] = (this._regs[regIndex] & HI_8) + byte;
    if (!Number.isInteger(this._regs[regIndex])) {
      debugger;
    }
  }

  _setHi(byte: number, regIndex: number): void {
    this._regs[regIndex] = (byte << 8) + (this._regs[regIndex] & LO_8);
    if (!Number.isInteger(this._regs[regIndex])) {
      debugger;
    }
  }

  setPc(word: number): void {
    if (!Number.isInteger(word)) {
      debugger;
    }
    this._regs[PC] = word;
  }

  setAf(word: number): void {
    this._regs[AF] = word;
  }

  setBc(word: number): void {
    this._regs[BC] = word;
  }

  setDe(word: number): void {
    this._regs[DE] = word;
  }

  setHl(word: number): void {
    this._regs[HL] = word;
  }

  setSp(word: number): void {
    this._regs[SP] = word;
  }

  setA(byte: number): void {
    this._setHi(byte, AF);
  }

  setF(byte: number): void {
    this._setLo(byte, AF);
  }

  setB(byte: number): void {
    this._setHi(byte, BC);
  }

  setC(byte: number): void {
    this._setLo(byte, BC);
  }

  setD(byte: number): void {
    this._setHi(byte, DE);
  }

  setE(byte: number): void {
    this._setLo(byte, DE);
  }

  setH(byte: number): void {
    this._setHi(byte, HL);
  }

  setL(byte: number): void {
    this._setLo(byte, HL);
  }

  decrA(): void {
    this._decrHi(AF);
  }

  decrB(): void {
    this._decrHi(BC);
  }

  decrC(): void {
    this._decrLo(BC);
  }

  decrD(): void {
    this._decrHi(DE);
  }

  decrE(): void {
    this._decrLo(DE);
  }

  decrH(): void {
    this._decrHi(HL);
  }

  decrL(): void {
    this._decrLo(HL);
  }

  incrA(): void {
    this._incrHi(AF);
  }

  incrB(): void {
    this._incrHi(BC);
  }

  incrC(): void {
    this._incrLo(BC);
  }

  incrD(): void {
    this._incrHi(DE);
  }

  incrE(): void {
    this._incrLo(DE);
  }

  incrH(): void {
    this._incrHi(HL);
  }

  incrL(): void {
    this._incrLo(HL);
  }

  incrBc(): void {
    this._incr(BC);
  }

  incrHl(): void {
    this._incr(HL);
  }

  incrPc(): void {
    this._incr(PC);
  }

  incrSp(): void {
    this._incr(SP);
  }

  decrSp(): void {
    this._decr(SP);
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
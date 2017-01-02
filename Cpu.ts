import { Clock } from './Clock';
import { Memory, Interrupt } from './Memory';
import { RegisterStore } from './RegisterStore';
import { decToHex } from './common';
import dedent = require('dedent');

type OpcodeSize = 1 | 2 | 3;
type OpcodeDuration = 4 | 8 | 12 | 16 | 20 | 24;

interface Opcode {
  // A human readable description of the instruction.
  mnemonic: string;
  // Width of the opcode in bytes, including the opcode byte itself.
  size: OpcodeSize;
  // Returns duration of executing the opcode.
  execute: (arg?: number) => OpcodeDuration;
}

export const CLOCK_SPEED = 4194304; // Cycles / second.

export class Cpu {
  _clock: Clock;
  _memory: Memory;
  _regs: RegisterStore;
  _ime: boolean; // Interrupt Master Enable Flag.

  constructor(clock: Clock, memory: Memory) {
    this._clock = clock;
    this._memory = memory;
    this._regs = new RegisterStore(memory);
    this._ime = true;
  }

  next(): void {
    const pc = this._regs.getPc();
    const code = this._memory.read(pc);
    const {size, execute} = code === 0xCB
      ? this._getPrefixCbOpcode()
      : this._getOpcode(code);
    const duration = this._executeOpcode(execute, size, pc, code);
    this._clock.advance(duration);
    this._processInterrupts();
    for (let i = 0; i < size; i++) {
      this._regs.incrPc();
    }
    if (isNaN(this._regs.getPc())) {
      debugger;
    }
    window.setImmediate(() => this.next());
  }

  _processInterrupts(): void {
    // Check for enabled interrupt requests from highest priority to lowest.
    const {vBlank, lcdStat, timer, serial, joypad} = this._memory.getInterruptInfo();
    [
      vBlank, // Highest priority.
      lcdStat,
      timer,
      serial,
      joypad, // Lowest priority.
    ].forEach(interrupt => this._processInterrupt(interrupt));
  }

  _processInterrupt(interrupt: Interrupt): void {
    // Note that a requested interrupt can only fire if it is enabled, and the IME is set.
    if (this._ime && interrupt.enabled && interrupt.requested) {
      this._ime = false;
      this._memory.unrequestInterrupt(interrupt.name);
      // 'Manually' perform a `call` instruction to enter the interrupt handler.
      const callOpcode = this._getOpcode(0xCD);
      const duration = callOpcode.execute(interrupt.vector << 8);
      this._clock.advance(duration);
    }
  }

  _executeOpcode(
    execute: (arg?: number) => number,
    size: OpcodeSize,
    pc: number,
    opcode: number,
  ): number {
    if (opcode === 0xCB) {
      return 4 + execute();
    }
    switch (size) {
      case 1: return execute();
      case 2: return execute(this._memory.read(pc + 1));
      case 3: return execute((this._memory.read(pc + 2) << 8) + this._memory.read(pc + 1));
      default: throw new Error(`Invalid size: ${size} for opcode: ${decToHex(opcode)}`);
    }
  }

  _getOpcode(opcode: number): Opcode {
    switch (opcode) {
      case 0x0: return {
        mnemonic: 'NOP',
        size: 1,
        execute: () => 4,
      };
      case 0x1: return {
        mnemonic: 'LD BC,d16',
        size: 3,
        execute: (arg: number) => {
          this._regs.setBc(arg);
          return 12;
        },
      };
      case 0x2: return {
        mnemonic: 'LD (BC),A',
        size: 1,
        execute: () => {
          this._regs.setA(this._memory.read(this._regs.getBc()));
          return 8;
        },
      };
      case 0x3: return {
        mnemonic: 'INC BC',
        size: 1,
        execute: () => {
          this._regs.incrBc();
          return 4;
        },
      };
      case 0x6: return {
        mnemonic: 'LD B,d8',
        size: 2,
        execute: (arg: number) => {
          this._regs.setB(arg);
          return 8;
        },
      };
      case 0xF: return {
        mnemonic: 'RRCA',
        size: 1,
        execute: () => {
          this._regs.rrca();
          return 4;
        },
      };
      case 0x11: return {
        mnemonic: 'LD DE,d16',
        size: 3,
        execute: (arg: number) => {
          this._regs.setDe(arg);
          return 12;
        },
      };
      case 0x14: return {
        mnemonic: 'INC D',
        size: 1,
        execute: () => {
          this._regs.incrD();
          return 4;
        },
      };
      case 0x16: return {
        mnemonic: 'LD D,d8',
        size: 2,
        execute: (arg: number) => {
          this._regs.setD(arg);
          return 8;
        },
      };
      case 0x18: return {
        mnemonic: 'JR r8',
        size: 2,
        execute: (arg: number) => {
          const pc = this._regs.getPc();
          const offset = getRelativeOffset(arg);
          this._regs.setPc(pc + offset);
          return 12;
        },
      };
      case 0x1A: return {
        mnemonic: 'LD A,(DE)',
        size: 1,
        execute: () => {
          this._regs.setA(this._memory.read(this._regs.getDe()));
          return 8;
        },
      };
      case 0x1F: return {
        mnemonic: 'RRA',
        size: 1,
        execute: () => {
          this._regs.rra();
          return 4;
        },
      };
      case 0x20: return {
        mnemonic: 'JR NZ,r8',
        size: 2,
        execute: (arg: number) => {
          if (this._regs.getFlagInfo().zero) {
            return 8;
          }
          const offset = getRelativeOffset(arg);
          this._regs.setPc(this._regs.getPc() + offset);
          return 12;
        },
      };
      case 0x21: return {
        mnemonic: 'LD HL,d16',
        size: 3,
        execute: (arg: number) => {
          this._regs.setHl(arg);
          return 12;
        },
      };
      case 0x22: return {
        mnemonic: 'LD (HL+),A',
        size: 1,
        execute: () => {
          this._memory.write(this._regs.getHl(), this._regs.getA());
          this._regs.incrHl();
          return 8;
        },
      };
      case 0x23: return {
        mnemonic: 'INC HL',
        size: 1,
        execute: () => {
          this._regs.incrHl();
          return 8;
        },
      };
      case 0x24: return {
        mnemonic: 'INC H',
        size: 1,
        execute: () => {
          this._regs.incrH();
          return 4;
        },
      };
      case 0x25: return {
        mnemonic: 'DEC H',
        size: 1,
        execute: () => {
          this._regs.decrH();
          return 4;
        },
      };
      case 0x26: return {
        mnemonic: 'LD H,d8',
        size: 2,
        execute: (arg: number) => {
          this._regs.setH(arg);
          return 8;
        },
      };
      case 0x28: return {
        mnemonic: 'JR Z,r8',
        size: 2,
        execute: (arg: number) => {
          if (this._regs.getFlagInfo().zero) {
            this._regs.setPc(this._regs.getPc() + u8ToI8(arg));
            return 12;
          }
          return 8;
        },
      };
      case 0x31: return {
        mnemonic: 'LD SP,d16',
        size: 3,
        execute: (arg: number) => {
          this._regs.setSp(arg);
          return 12;
        },
      };
      case 0x36: return {
        mnemonic: 'LD (HL),d8',
        size: 2,
        execute: (arg: number) => {
          this._memory.write(this._regs.getHl(), arg);
          return 12;
        },
      };
      case 0x3C: return {
        mnemonic: 'INC A',
        size: 1,
        execute: () => {
          this._regs.incrA();
          return 4;
        },
      };
      case 0x3E: return {
        mnemonic: 'LD A,d8',
        size: 2,
        execute: (arg: number) => {
          this._regs.setA(arg);
          return 8;
        },
      };
      case 0x40: return {
        mnemonic: 'LD B,B',
        size: 1,
        execute: () => {
          this._regs.setB(this._regs.getB());
          return 4;
        },
      };
      case 0x41: return {
        mnemonic: 'LD B,C',
        size: 1,
        execute: () => {
          this._regs.setB(this._regs.getC());
          return 4;
        },
      };
      case 0x42: return {
        mnemonic: 'LD B,D',
        size: 1,
        execute: () => {
          this._regs.setB(this._regs.getD());
          return 4;
        },
      };
      case 0x43: return {
        mnemonic: 'LD B,E',
        size: 1,
        execute: () => {
          this._regs.setB(this._regs.getE());
          return 4;
        },
      };
      case 0x44: return {
        mnemonic: 'LD B,H',
        size: 1,
        execute: () => {
          this._regs.setB(this._regs.getH());
          return 4;
        },
      };
      case 0x45: return {
        mnemonic: 'LD B,L',
        size: 1,
        execute: () => {
          this._regs.setB(this._regs.getL());
          return 4;
        },
      };
      case 0x46: return {
        mnemonic: 'LD B,(HL)',
        size: 1,
        execute: () => {
          this._regs.setB(this._memory.read(this._regs.getHl()));
          return 8;
        },
      };
      case 0x47: return {
        mnemonic: 'LD B,A',
        size: 1,
        execute: () => {
          this._regs.setB(this._regs.getA());
          return 4;
        },
      };
      case 0x48: return {
        mnemonic: 'LD C,B',
        size: 1,
        execute: () => {
          this._regs.setC(this._regs.getB());
          return 4;
        },
      };
      case 0x49: return {
        mnemonic: 'LD C,C',
        size: 1,
        execute: () => {
          this._regs.setC(this._regs.getC());
          return 4;
        },
      };
      case 0x4A: return {
        mnemonic: 'LD C,D',
        size: 1,
        execute: () => {
          this._regs.setC(this._regs.getD());
          return 4;
        },
      };
      case 0x4B: return {
        mnemonic: 'LD C,E',
        size: 1,
        execute: () => {
          this._regs.setC(this._regs.getE());
          return 4;
        },
      };
      case 0x4C: return {
        mnemonic: 'LD C,H',
        size: 1,
        execute: () => {
          this._regs.setC(this._regs.getH());
          return 4;
        },
      };
      case 0x4D: return {
        mnemonic: 'LD C,L',
        size: 1,
        execute: () => {
          this._regs.setC(this._regs.getL());
          return 4;
        },
      };
      case 0x4E: return {
        mnemonic: 'LD C,(HL)',
        size: 1,
        execute: () => {
          this._regs.setC(this._memory.read(this._regs.getHl()));
          return 4;
        },
      };
      case 0x4F: return {
        mnemonic: 'LD C,A',
        size: 1,
        execute: () => {
          this._regs.setC(this._regs.getA());
          return 4;
        },
      };
      case 0x50: return {
        mnemonic: 'LD D,B',
        size: 1,
        execute: () => {
          this._regs.setD(this._regs.getB());
          return 4;
        },
      };
      case 0x51: return {
        mnemonic: 'LD D,C',
        size: 1,
        execute: () => {
          this._regs.setD(this._regs.getC());
          return 4;
        },
      };
      case 0x52: return {
        mnemonic: 'LD D,D',
        size: 1,
        execute: () => {
          this._regs.setD(this._regs.getD());
          return 4;
        },
      };
      case 0x53: return {
        mnemonic: 'LD D,E',
        size: 1,
        execute: () => {
          this._regs.setD(this._regs.getE());
          return 4;
        },
      };
      case 0x54: return {
        mnemonic: 'LD D,H',
        size: 1,
        execute: () => {
          this._regs.setD(this._regs.getH());
          return 4;
        },
      };
      case 0x55: return {
        mnemonic: 'LD D,L',
        size: 1,
        execute: () => {
          this._regs.setD(this._regs.getL());
          return 4;
        },
      };
      case 0x56: return {
        mnemonic: 'LD D,(HL)',
        size: 1,
        execute: () => {
          this._regs.setD(this._memory.read(this._regs.getHl()));
          return 8;
        },
      };
      case 0x57: return {
        mnemonic: 'LD D,A',
        size: 1,
        execute: () => {
          this._regs.setD(this._regs.getA());
          return 4;
        },
      };
      case 0x58: return {
        mnemonic: 'LD E,B',
        size: 1,
        execute: () => {
          this._regs.setE(this._regs.getB());
          return 4;
        },
      };
      case 0x59: return {
        mnemonic: 'LD E,C',
        size: 1,
        execute: () => {
          this._regs.setE(this._regs.getC());
          return 4;
        },
      };
      case 0x5A: return {
        mnemonic: 'LD E,D',
        size: 1,
        execute: () => {
          this._regs.setE(this._regs.getD());
          return 4;
        },
      };
      case 0x5B: return {
        mnemonic: 'LD E,E',
        size: 1,
        execute: () => {
          this._regs.setE(this._regs.getE());
          return 4;
        },
      };
      case 0x5C: return {
        mnemonic: 'LD E,H',
        size: 1,
        execute: () => {
          this._regs.setE(this._regs.getH());
          return 4;
        },
      };
      case 0x5D: return {
        mnemonic: 'LD E,L',
        size: 1,
        execute: () => {
          this._regs.setE(this._regs.getL());
          return 4;
        },
      };
      case 0x5E: return {
        mnemonic: 'LD E,(HL)',
        size: 1,
        execute: () => {
          this._regs.setE(this._memory.read(this._regs.getHl()));
          return 8;
        },
      };
      case 0x5F: return {
        mnemonic: 'LD E,A',
        size: 1,
        execute: () => {
          this._regs.setE(this._regs.getA());
          return 4;
        },
      };
      case 0x60: return {
        mnemonic: 'LD H,B',
        size: 1,
        execute: () => {
          this._regs.setH(this._regs.getB());
          return 4;
        },
      };
      case 0x61: return {
        mnemonic: 'LD H,C',
        size: 1,
        execute: () => {
          this._regs.setH(this._regs.getC());
          return 4;
        },
      };
      case 0x62: return {
        mnemonic: 'LD H,D',
        size: 1,
        execute: () => {
          this._regs.setH(this._regs.getD());
          return 4;
        },
      };
      case 0x63: return {
        mnemonic: 'LD H,E',
        size: 1,
        execute: () => {
          this._regs.setH(this._regs.getE());
          return 4;
        },
      };
      case 0x64: return {
        mnemonic: 'LD H,H',
        size: 1,
        execute: () => {
          this._regs.setH(this._regs.getH());
          return 4;
        },
      };
      case 0x65: return {
        mnemonic: 'LD H,L',
        size: 1,
        execute: () => {
          this._regs.setH(this._regs.getL());
          return 4;
        },
      };
      case 0x66: return {
        mnemonic: 'LD H,(HL)',
        size: 1,
        execute: () => {
          this._regs.setH(this._memory.read(this._regs.getHl()));
          return 8;
        },
      };
      case 0x67: return {
        mnemonic: 'LD H,A',
        size: 1,
        execute: () => {
          this._regs.setH(this._regs.getA());
          return 4;
        },
      };
      case 0x68: return {
        mnemonic: 'LD L,B',
        size: 1,
        execute: () => {
          this._regs.setL(this._regs.getB());
          return 4;
        },
      };
      case 0x69: return {
        mnemonic: 'LD L,C',
        size: 1,
        execute: () => {
          this._regs.setL(this._regs.getC());
          return 4;
        },
      };
      case 0x6A: return {
        mnemonic: 'LD L,D',
        size: 1,
        execute: () => {
          this._regs.setL(this._regs.getD());
          return 4;
        },
      };
      case 0x6B: return {
        mnemonic: 'LD L,E',
        size: 1,
        execute: () => {
          this._regs.setL(this._regs.getE());
          return 4;
        },
      };
      case 0x6C: return {
        mnemonic: 'LD L,H',
        size: 1,
        execute: () => {
          this._regs.setL(this._regs.getH());
          return 4;
        },
      };
      case 0x6D: return {
        mnemonic: 'LD L,L',
        size: 1,
        execute: () => {
          this._regs.setL(this._regs.getL());
          return 4;
        },
      };
      case 0x6E: return {
        mnemonic: 'LD L,(HL)',
        size: 1,
        execute: () => {
          this._regs.setL(this._memory.read(this._regs.getHl()));
          return 8;
        },
      };
      case 0x6F: return {
        mnemonic: 'LD L,A',
        size: 1,
        execute: () => {
          this._regs.setL(this._regs.getA());
          return 4;
        },
      };
      case 0x80: return {
        mnemonic: 'ADD A,B',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.add(this._regs.getB()));
          return 4;
        },
      };
      case 0x81: return {
        mnemonic: 'ADD A,C',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.add(this._regs.getC()));
          return 4;
        },
      };
      case 0x82: return {
        mnemonic: 'ADD A,D',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.add(this._regs.getD()));
          return 4;
        },
      };
      case 0x83: return {
        mnemonic: 'ADD A,E',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.add(this._regs.getE()));
          return 4;
        },
      };
      case 0x84: return {
        mnemonic: 'ADD A,H',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.add(this._regs.getH()));
          return 4;
        },
      };
      case 0x85: return {
        mnemonic: 'ADD A,L',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.add(this._regs.getL()));
          return 4;
        },
      };
      case 0x86: return {
        mnemonic: 'ADD A,(HL)',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.add(this._memory.read(this._regs.getHl())));
          return 8;
        },
      };
      case 0x87: return {
        mnemonic: 'ADD A,A',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.add(this._regs.getA()));
          return 4;
        },
      };
      case 0xA0: return {
        mnemonic: 'AND B',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.and(this._regs.getB()));
          return 4;
        },
      };
      case 0xA9: return {
        mnemonic: 'XOR C',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.xor(this._regs.getC()));
          return 4;
        },
      };
      case 0xAA: return {
        mnemonic: 'XOR D',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.xor(this._regs.getD()));
          return 4;
        },
      };
      case 0xAB: return {
        mnemonic: 'XOR E',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.xor(this._regs.getE()));
          return 4;
        },
      };
      case 0xAC: return {
        mnemonic: 'XOR H',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.xor(this._regs.getH()));
          return 4;
        },
      };
      case 0xAD: return {
        mnemonic: 'XOR L',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.xor(this._regs.getL()));
          return 4;
        },
      };
      case 0xAE: return {
        mnemonic: 'XOR (HL)',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.xor(this._memory.read(this._regs.getHl())));
          return 8;
        },
      };
      case 0xAF: return {
        mnemonic: 'XOR A',
        size: 1,
        execute: () => {
          this._regs.setA(this._regs.xor(this._regs.getA()));
          return 4;
        },
      };
      case 0xB8: return {
        mnemonic: 'CP B',
        size: 1,
        execute: () => {
          this._regs.cpB();
          return 4;
        },
      };
      case 0xC1: return {
        mnemonic: 'POP BC',
        size: 1,
        execute: () => {
          this._regs.popBc();
          return 12;
        },
      };
      case 0xC3: return {
        mnemonic: 'JP a16',
        size: 3,
        execute: (arg: number) => {
          this._regs.setPc(arg);
          return 16;
        },
      };
      case 0xC5: return {
        mnemonic: 'PUSH BC',
        size: 1,
        execute: () => {
          this._regs.pushBc();
          return 16;
        },
      };
      case 0xCD: return {
        mnemonic: 'CALL a16',
        size: 3,
        execute: (arg: number) => {
          this._call(arg);
          return 24;
        },
      };
      case 0xCF: return {
        mnemonic: 'RST 08H',
        size: 1,
        execute: () => {
          this._call(0x08);
          return 16;
        },
      };
      case 0xD0: return {
        mnemonic: 'RET NC',
        size: 1,
        execute: () => {
          if (!this._regs.getFlagInfo().carry) {
            this._return();
            return 20;
          }
          return 8;
        },
      };
      case 0xD1: return {
        mnemonic: 'POP DE',
        size: 1,
        execute: () => {
          this._regs.popDe();
          return 12;
        },
      };
      case 0xD5: return {
        mnemonic: 'PUSH DE',
        size: 1,
        execute: () => {
          this._regs.pushDe();
          return 16;
        },
      };
      case 0xD9: return {
        mnemonic: 'RETI',
        size: 1,
        execute: () => {
          this._ime = true;
          this._return();
          return 16;
        },
      };
      case 0xE0: return {
        mnemonic: 'LDH (a8),A',
        size: 2,
        execute: (arg: number) => {
          this._memory.write(arg + 0xFF00, this._regs.getA());
          return 12;
        },
      };
      case 0xE1: return {
        mnemonic: 'POP HL',
        size: 1,
        execute: () => {
          this._regs.popHl();
          return 12;
        },
      };
      case 0xE5: return {
        mnemonic: 'PUSH HL',
        size: 1,
        execute: () => {
          this._regs.pushHl();
          return 16;
        },
      };
      case 0xEA: return {
        mnemonic: 'LD (a16),A',
        size: 3,
        execute: (arg: number) => {
          this._memory.write(arg, this._regs.getA());
          return 16;
        },
      };
      case 0xF0: return {
        mnemonic: 'LDH A,(a8)',
        size: 2,
        execute: (arg: number) => {
          this._regs.setA(this._memory.read(0xFF00 + arg));
          return 12;
        },
      };
      case 0xF1: return {
        mnemonic: 'POP AF',
        size: 1,
        execute: () => {
          this._regs.popAf();
          return 12;
        },
      };
      case 0xFA: return {
        mnemonic: 'LD A,(a16)',
        size: 3,
        execute: (arg: number) => {
          this._regs.setA(this._memory.read(arg));
          return 16;
        },
      };
      case 0xFE: return {
        mnemonic: 'CP d8',
        size: 2,
        execute: (arg: number) => {
          this._regs.cp(arg);
          return 8;
        },
      };
      case 0xFF: return {
        mnemonic: 'RST 38H',
        size: 1,
        execute: () => {
          this._call(0x38);
          return 16;
        },
      };
      default: {
        throw new Error(dedent`\n\n
          Unimplemented instruction: 0x${decToHex(opcode)}
          at memory address: 0x${decToHex(this._regs.getPc())}
        `);
      }
    }
  }

  _call(addr: number): void {
    this._regs.pushPc();
    this._regs.setPc(addr);
  }

  _return(): void {
    this._regs.popPc();
  }

  _getPrefixCbOpcode(): Opcode {
    debugger;
    // The PC is on the CB instruction, we need the byte after it.
    const opcode = this._memory.read(this._regs.getPc() + 1);
    switch (opcode) {
      case 0x87: return {
        mnemonic: 'RES 0,A',
        size: 2,
        execute: () => {
          this._regs.resetA(0);
          return 8;
        },
      };
      default: throw new Error(`Unimplemented CB: 0x${decToHex(opcode)}`);
    }
  }
}

function u8ToI8(u8: number): number {
  return u8 > 127 ? u8 - 256 : u8;
}

function getRelativeOffset(offset: number): number {
  return offset >= 0x80 ? offset - 0x100 : offset;
}
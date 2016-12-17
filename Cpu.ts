import { Clock } from './Clock';
import { Memory, Interrupt } from './Memory';
import { RegisterStore } from './RegisterStore';

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
    this._regs = new RegisterStore();
    this._ime = true;
  }

  next(): void {
    const pc = this._regs.getPc();
    const code = this._memory.read(pc);
    const {size, execute} = this._getOpcode(code);
    const duration = this._executeOpcode(execute, size, pc, code);
    this._clock.advance(duration);
    this._processInterrupts();
    this._regs.incrPc();
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
      case 0x11: return {
        mnemonic: 'LD DE,d16',
        size: 3,
        execute: (args: number) => {
          this._regs.setDe(args);
          return 12;
        },
      };
      case 0x28: return {
        mnemonic: 'JR Z,r8',
        size: 2,
        execute: (args: number) => {
          if (this._regs.getFlagInfo().zero) {
            this._regs.setPc(this._regs.getPc() + u8ToI8(args));
            return 12;
          }
          return 8;
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
      default: {
        throw new Error(
          `\nUnimplemented instruction: 0x${decToHex(opcode)}` +
          `\nat memory address: 0x${decToHex(this._regs.getPc())}`,
        );
      }
    }
  }
}

function decToHex(opcode: number): string {
  return Number(opcode).toString(16).toUpperCase();
}

function u8ToI8(u8: number): number {
  return u8 > 127 ? u8 - 256 : u8;
}

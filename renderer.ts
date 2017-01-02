import * as fs from 'fs';
import {Memory} from './Memory.js';
import {Cpu} from './Cpu.js';
import {Clock} from './Clock.js';
import {Display} from './Display';

const rom = fs.readFileSync(`${__dirname}/../pokemonblue.gb`);
const clock = new Clock();
const memory = new Memory(rom, clock);
const cpu = new Cpu(clock, memory);
new Display(clock, memory);
cpu.next();
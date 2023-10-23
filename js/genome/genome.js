import {StringUtils} from "../../node_modules/igv-utils/src/index.js"
import Chromosome from "./chromosome.js"
import {loadFasta} from "./fasta.js"
import ChromAliasBB from "./chromAliasBB.js"
import ChromAliasFile from "./chromAliasFile.js"
import CytobandFileBB from "./cytobandFileBB.js"
import CytobandFile from "./cytobandFile.js"

import {loadChromSizes} from "./chromSizes.js"

/**
 * The Genome class represents an assembly and consists of the following elements
 *   sequence - Object representing the DNA sequence
 *   chromosomes - Objects with chromosome meta data including name, length, and alternate names (aliases)
 *   aliases - table of chromosome name aliases (optional)
 *   cytobands - cytoband data for drawing an ideogram (optional)
 */

class Genome {

    static async loadGenome(options) {

        const genome = new Genome(options)
        await genome.init()
        return genome
    }

    constructor(config) {
        this.config = config
        this.id = config.id || generateGenomeID(config)
        this.name = config.name
        this.nameSet = config.nameSet

    }

    async init() {

        const config = this.config

        this.sequence = await loadFasta(config)

        if (config.chromSizes) {
            // a chromSizes file is neccessary for 2bit sequences for whole-genome view or chromosome pulldown
            this.chromosomes = await loadChromSizes(config.chromSizes)
        } else {
            this.chromosomes = this.sequence.chromosomes || new Map() // This might be undefined, depending on sequence type
        }

        // For backward compatibility
        if(this.chromosomes.size > 0) {
            this.chromosomeNames = Array.from(this.chromosomes.keys())
        }


        if (config.chromAliasBbURL) {
            this.chromAlias = new ChromAliasBB(config.chromAliasBbURL, Object.assign({}, config), this)
        } else if (config.aliasURL) {
            this.chromAlias = new ChromAliasFile(config.aliasURL, Object.assign({}, config), this)
        }

        if (config.cytobandBbURL) {
            this.cytobandSource = new CytobandFileBB(config.cytobandBbURL, Object.assign({}, config), this)
        } else if(config.cytobandURL) {
            this.cytobandSource = new CytobandFile(config.cytobandURL, Object.assign({}, config))
        }

        if (false !== config.wholeGenomeView && this.chromosomes.size > 0) {
            // Set chromosome order for WG view and chromosome pulldown.  If chromosome order is not specified sort
            if (config.chromosomeOrder) {
                if (Array.isArray(config.chromosomeOrder)) {
                    this.wgChromosomeNames = config.chromosomeOrder
                } else {
                    this.wgChromosomeNames = config.chromosomeOrder.split(',').map(nm => nm.trim())
                }
            } else {
                this.wgChromosomeNames = trimSmallChromosomes(this.chromosomes)
            }
        }

        // Optionally create the psuedo chromosome "all" to support whole genome view
        this.wholeGenomeView = config.wholeGenomeView !== false && this.wgChromosomeNames && this.chromosomes.size > 1
        if (this.wholeGenomeView) {
            const l = this.wgChromosomeNames.reduce((accumulator, currentValue) => accumulator += this.chromosomes.get(currentValue).bpLength, 0)
            this.chromosomes.set("all", new Chromosome("all", 0, l))
        }
    }



    get description() {
        return this.config.description || `${this.id}\n${this.name}`
    }

    get infoURL() {
        return this.config.infoURL
    }

    showWholeGenomeView() {
        return this.wholeGenomeView
    }

    /**
     * Return a json like object representing the current state.  The tracks collection is nullified
     * as tracks are transferred to the browser object on loading.
     *
     * @returns {any}
     */
    toJSON() {
        return Object.assign({}, this.config, {tracks: undefined})
    }

    getInitialLocus() {

    }

    getHomeChromosomeName() {
        if (this.showWholeGenomeView() && this.chromosomes.has("all")) {
            return "all"
        } else {
            return this.sequence.getFirstChromosomeName()

        }
    }

    getChromosomeName(chr) {
        return this.chromAlias ? this.chromAlias.getChromosomeName(chr) : chr
    }

    getChromosomeDisplayName(str) {
        if (this.nameSet && this.chromAlias) {
            return this.chromAlias.getChromosomeAlias(str, this.nameSet) || str
        } else {
            return str
        }
    }

    getChromosome(chr) {
        if (this.chromAlias) {
            chr = this.chromAlias.getChromosomeName(chr)
        }
        return this.chromosomes.get(chr)
    }

    async loadChromosome(chr) {

        if (!this.chromosomes.has(chr)) {
            const sequenceRecord = await this.sequence.getSequenceRecord(chr)
            if (sequenceRecord) {
                const chromosome = new Chromosome(chr, 0, sequenceRecord.bpLength)
                this.chromosomes.set(chr, chromosome)
            } else {
                // Try alias
                if (this.chromAlias) {
                    const chromAliasRecord = await this.chromAlias.search(chr)
                    if (chromAliasRecord) {
                        const chromosome = new Chromosome(chromAliasRecord.chr, 0, sequenceRecord.bpLength)
                        this.chromosomes.set(chr, chromosome)
                    }
                }

                this.chromosomes.set(chr, undefined)  // Prevents future attempts
            }
        }

        return this.chromosomes.get(chr)
    }

    async getAliasRecord(chr) {
        if (this.chromAlias) {
            return this.chromAlias.search(chr)
        }
    }


    getCytobands(chr) {
        if (this.cytobandSource) {
            const chrName = this.getChromosomeName(chr)
            return this.cytobandSource.getCytobands(chrName)
        }
    }

    getChromosomes() {
        return this.chromosomes
    }

    /**
     * Return the genome coordinate in kb for the give chromosome and position.
     * NOTE: This might return undefined if the chr is filtered from whole genome view.
     */
    getGenomeCoordinate(chr, bp) {

        var offset = this.getCumulativeOffset(chr)
        if (offset === undefined) return undefined

        return offset + bp
    }

    /**
     * Return the chromosome and coordinate in bp for the given genome coordinate
     */
    getChromosomeCoordinate(genomeCoordinate) {

        if (this.cumulativeOffsets === undefined) {
            this.cumulativeOffsets = computeCumulativeOffsets.call(this)
        }

        let lastChr = undefined
        let lastCoord = 0
        for (let name of this.wgChromosomeNames) {

            const cumulativeOffset = this.cumulativeOffsets[name]
            if (cumulativeOffset > genomeCoordinate) {
                const position = genomeCoordinate - lastCoord
                return {chr: lastChr, position: position}
            }
            lastChr = name
            lastCoord = cumulativeOffset
        }

        // If we get here off the end
        return {chr: this.wgChromosomeNames[this.wgChromosomeNames.length - 1], position: 0}

    };


    /**
     * Return the offset in genome coordinates (kb) of the start of the given chromosome
     * NOTE:  This might return undefined if the chromosome is filtered from whole genome view.
     */
    getCumulativeOffset(chr) {

        if (this.cumulativeOffsets === undefined) {
            this.cumulativeOffsets = computeCumulativeOffsets.call(this)
        }

        const queryChr = this.getChromosomeName(chr)
        return this.cumulativeOffsets[queryChr]

        function computeCumulativeOffsets() {

            let self = this
            let acc = {}
            let offset = 0
            for (let name of self.wgChromosomeNames) {

                acc[name] = Math.floor(offset)

                const chromosome = self.getChromosome(name)

                offset += chromosome.bpLength
            }

            return acc
        }
    }

    /**
     * Return the nominal genome length, this is the length of the main chromosomes (no scaffolds, etc).
     */
    getGenomeLength() {

        if (!this.bpLength) {
            let bpLength = 0
            for (let cname of this.wgChromosomeNames) {
                let c = this.chromosomes.get(cname)
                bpLength += c.bpLength
            }
            this.bpLength = bpLength
        }
        return this.bpLength
    }

    async getSequence(chr, start, end) {
        chr = this.getChromosomeName(chr)
        return this.sequence.getSequence(chr, start, end)
    }

    constructWG(config) {

        // Compute psuedo-chromosome "all"
        const l = this.wgChromosomeNames.reduce((accumulator, currentValue) => accumulator += this.chromosomes.get(currentValue).bpLength, 0)
        this.chromosomes.set("all", new Chromosome("all", 0, l))
    }
}

/**
 * Trim small sequences (chromosomes) and return the list of trimmed chromosome names.
 * The results are used to construct the whole genome view and optionally chromosome pulldown
 * *
 * @param config - the "reference" configuration object
 * @returns {string|*|*[]|string[]}
 */
function trimSmallChromosomes(chromosomes) {

    const wgChromosomeNames = []
    let runningAverage
    let i = 1
    for (let c of chromosomes.values()) {
        if (!runningAverage) {
            runningAverage = c.bpLength
            wgChromosomeNames.push(c.name)
        } else {
            if (c.bpLength < runningAverage / 100) {
                continue
            }
            runningAverage = ((i - 1) * runningAverage + c.bpLength) / i
            wgChromosomeNames.push(c.name)
        }
        i++
    }
    return wgChromosomeNames
}

function isDigit(val) {
    return /^\d+$/.test(val)
}

function generateGenomeID(config) {
    if (config.id !== undefined) {
        return config.id
    } else if (config.fastaURL && StringUtils.isString(config.fastaURL)) {
        return config.fastaURL
    } else if (config.fastaURL && config.fastaURL.name) {
        return config.fastaURL.name
    } else {
        return ("0000" + (Math.random() * Math.pow(36, 4) << 0).toString(36)).slice(-4)
    }
}

export default Genome

// @flow

import { CircleLayoutArray } from '../array_types';

import { members as layoutAttributes } from './circle_attributes';
import SegmentVector from '../segment';
import { ProgramConfigurationSet } from '../program_configuration';
import { TriangleIndexArray } from '../index_array_type';
import EXTENT from '../extent';

import type Context from '../../gl/context';
import type IndexBuffer from '../../gl/index_buffer';
import type VertexBuffer from '../../gl/vertex_buffer';

/**
 * See CircleBucket for per-tile implementation
 * GlobalCircleBucket is different from other buckets in that it is dynamically
 * generated on the foreground out of a set of individual CircleBuckets
 *
 * @private
 */
class GlobalCircleBucket {
    layerIds: Array<string>;
    layers: Array<Layer>;

    tileLayoutVertexArrays: Array<CircleLayoutArray>;
    layoutVertexArray: CircleLayoutArray;
    layoutVertexBuffer: VertexBuffer;

    indexArray: TriangleIndexArray;
    indexBuffer: IndexBuffer;

    programConfigurations: ProgramConfigurationSet<Layer>;
    tileProgramConfigurations: Array<ProgramConfigurationSet<Layer>>;
    segments: SegmentVector;
    uploaded: boolean

    constructor(options: any) {
        this.layerIds = options.layerIds;
        this.layers = options.layers;

        this.tileLayoutVertexArrays = {};
        this.tileProgramConfigurations = {};
        this.zoom = 0;

        this.layoutVertexArray = new CircleLayoutArray();
        this.indexArray = new TriangleIndexArray();
        this.segments = new SegmentVector();
        this.programConfigurations = new ProgramConfigurationSet(layoutAttributes, options.layers, 0); // TODO figure out zoom, shared program configs, etc.
    }

    update() {
        // TODO: Implement feature states and paint array updates!
    }

    isEmpty() {
        return this.layoutVertexArray.length === 0;
    }

    uploadPending() {
        return !this.uploaded || this.programConfigurations.needsUpload;
    }

    addTileBucket(bucket: CircleBucket) {
        const key = bucket.layerIds[0] + bucket.tileID.toString() + "/" + bucket.tileID.wrap;
        console.log("Adding " + key);
        this.tileLayoutVertexArrays[key] = bucket.layoutVertexArray;
        this.tileProgramConfigurations[key] = bucket.programConfigurations;
        this.zoom = bucket.zoom;
        this.uploaded = false;
    }

    removeTileBucket(bucket: CircleBucket) {
        const key = bucket.layerIds[0] + bucket.tileID.toString() + "/" + bucket.tileID.wrap;
        console.log("Removing " + key);
        delete this.tileLayoutVertexArrays[key];
        delete this.tileProgramConfigurations[key];
        this.uploaded = false;
    }

    upload(context: Context) {
        if (!this.uploaded) {
            this.generateArrays();
            this.layoutVertexBuffer = context.createVertexBuffer(this.layoutVertexArray, layoutAttributes);
            this.indexBuffer = context.createIndexBuffer(this.indexArray);
        }
        this.programConfigurations.upload(context);
        this.uploaded = true;
    }

    destroy() {
        if (!this.layoutVertexBuffer) return;
        this.layoutVertexBuffer.destroy();
        this.indexBuffer.destroy();
        this.programConfigurations.destroy();
        this.segments.destroy();
    }

    copyLayoutVertex(tileLayoutVertexArray, i) {
        this.layoutVertexArray.emplaceBack(
            tileLayoutVertexArray.uint16[i],
            tileLayoutVertexArray.uint16[i + 1],
            tileLayoutVertexArray.uint16[i + 2],
            tileLayoutVertexArray.uint16[i + 3]
        );
    }

    generateArrays() {
        // TODO: Resetting all state, Copying and reuploading everything is the least efficient way to do this!
        if (this.programConfigurations) {
            this.programConfigurations.destroy();
        }
        if (this.segments) {
            this.segments.destroy();
        }
        if (this.layoutVertexBuffer) {
            this.layoutVertexBuffer.destroy();
        }
        if (this.indexBuffer) {
            this.indexBuffer.destroy();
        }

        this.segments = new SegmentVector();
        this.layoutVertexArray = new CircleLayoutArray();
        this.indexArray = new TriangleIndexArray();
        this.programConfigurations = new ProgramConfigurationSet(layoutAttributes, this.layers, this.zoom); // TODO figure out zoom, shared program configs, etc.

        const circles = this.programConfigurations.programConfigurations.circles;
        for (const property in circles.binders) {
            const binder = circles.binders[property];
            if (!binder.paintVertexArray) continue;
            for (const key in this.tileProgramConfigurations) {
                binder.paintVertexArray._trim();
                const tileProgramConfiguration = this.tileProgramConfigurations[key];
                binder.maxValue = Math.max(binder.maxValue, tileProgramConfiguration.programConfigurations.circles.binders[property].maxValue);
                const tilePaintVertexArray = tileProgramConfiguration.programConfigurations.circles.binders[property].paintVertexArray;
                const baseIndex = binder.paintVertexArray.length;
                const baseIndexUint8 = binder.paintVertexArray.uint8.length;
                binder.paintVertexArray.resize(baseIndex + tilePaintVertexArray.length);
                binder.paintVertexArray._trim();
                for (let i = 0; i < tilePaintVertexArray.uint8.length; i++) {
                    binder.paintVertexArray.uint8[baseIndexUint8 + i] = tilePaintVertexArray.uint8[i];
                }
            }
        }
        this.programConfigurations.needsUpload = true;

        this.layoutVertexArray.reserve(Object.values(this.tileLayoutVertexArrays).reduce((sum, current) => {
            return sum + current.length;
        }, 0));

        const indexPositions = [];
        for (const key in this.tileLayoutVertexArrays) {
            const tileLayoutVertexArray = this.tileLayoutVertexArrays[key];
            for (let i = 0; i < tileLayoutVertexArray.length * 4; i += 16) {
                const segment = this.segments.prepareSegment(4, this.layoutVertexArray, this.indexArray);
                const index = segment.vertexLength;

                this.copyLayoutVertex(tileLayoutVertexArray, i);
                this.copyLayoutVertex(tileLayoutVertexArray, i + 4);
                this.copyLayoutVertex(tileLayoutVertexArray, i + 8);
                this.copyLayoutVertex(tileLayoutVertexArray, i + 12);

                // TODO: this is a poor-man's low precision, no rotation y-sort
                const y = tileLayoutVertexArray.uint16[i + 1];

                indexPositions.push({ y, index });

                segment.vertexLength += 4;
                segment.primitiveLength += 2; // Is it OK that we add these later?
            }
        }
        indexPositions.sort((a, b) => {
            return a.y - b.y;
        });
        for (const indexPosition of indexPositions) {
            const index = indexPosition.index;
            this.indexArray.emplaceBack(index, index + 1, index + 2);
            this.indexArray.emplaceBack(index, index + 3, index + 2);

        }
        this.indexArray._trim();
        this.layoutVertexArray._trim();

    }
}

export default GlobalCircleBucket;

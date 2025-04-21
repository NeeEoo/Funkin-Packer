import list from './list.json';
import appInfo from '../../../package.json';
import {GET} from '../utils/ajax';
import {strNumPairCompare} from '../utils/common';
import mustache from 'mustache';
import wax from '@jvitela/mustache-wax';
import { smartSortImages, removeFromArray } from '../utils/common';

wax(mustache);

mustache.Formatters = {
    add: (v1, v2) => {
        return v1 + v2;
    },
    subtract: (v1, v2) => {
        return v1 - v2;
    },
    multiply: (v1, v2) => {
        return v1 * v2;
    },
    divide: (v1, v2) => {
        return v1 / v2;
    },
    offsetLeft: (start, size1, size2) => {
        let x1 = start + size1 / 2;
        let x2 = size2 / 2;
        return x1 - x2;
    },
    offsetRight: (start, size1, size2) => {
        let x1 = start + size1 / 2;
        let x2 = size2 / 2;
        return x2 - x1;
    },
    mirror: (start, size1, size2) => {
        return size2 - start - size1;
    },
    escapeName: (name) => {
        return name.replace(/%/g, "%25")
            .replace(/#/g, "%23")
            .replace(/:/g, "%3A")
            .replace(/;/g, "%3B")
            .replace(/\\/g, "-")
            .replace(/\//g, "-");
    }
};

function getExporterByType(type) {
    for(let item of list) {
        if(item.type === type) {
            return item;
        }
    }
    return null;
}

function prepareData(data, options) {

    let opt = Object.assign({}, options);

    opt.imageName = opt.imageName || "texture";
    opt.imageFile = opt.imageFile || (opt.imageName + "." + options.textureFormat);
    opt.format = opt.format || "RGBA8888";
    opt.scale = opt.scale || 1;
    opt.base64Prefix = options.textureFormat === "png" ? "data:image/png;base64," : "data:image/jpeg;base64,";

    let ret = [];

    for(let item of data) {

        let name = item.originalFile || item.file;
        var origName = name;

        if(options.trimSpriteNames) {
            name.trim();
        }

        if(options.removeFileExtension) {
            let parts = name.split(".");
            if(parts.length > 1) parts.pop();
            name = parts.join(".");
        }

        if(!options.prependFolderName) {
            name = name.split("/").pop();
        }

        let frame = {x: item.frame.x, y: item.frame.y, w: item.frame.w, h: item.frame.h, hw: item.frame.w/2, hh: item.frame.h/2};
        let spriteSourceSize = {x: item.spriteSourceSize.x, y: item.spriteSourceSize.y, w: item.spriteSourceSize.w, h: item.spriteSourceSize.h};
        let sourceSize = {w: item.sourceSize.w, h: item.sourceSize.h};

        let trimmed = item.trimmed;

        if(item.trimmed && options.trimMode === 'crop') {
            trimmed = false;
            spriteSourceSize.x = 0;
            spriteSourceSize.y = 0;
            sourceSize.w = spriteSourceSize.w;
            sourceSize.h = spriteSourceSize.h;
        }

        if(opt.scale !== 1) { // Maybe round if sparrow?
            frame.x *= opt.scale;
            frame.y *= opt.scale;
            frame.w *= opt.scale;
            frame.h *= opt.scale;
            frame.hw *= opt.scale;
            frame.hh *= opt.scale;

            spriteSourceSize.x *= opt.scale;
            spriteSourceSize.y *= opt.scale;
            spriteSourceSize.w *= opt.scale;
            spriteSourceSize.h *= opt.scale;

            sourceSize.w *= opt.scale;
            sourceSize.h *= opt.scale;
        }

        ret.push({
            name: name,
            origName: origName,
            frame: frame,
            spriteSourceSize: spriteSourceSize,
            sourceSize: sourceSize,
            rotated: item.rotated,
            trimmed: trimmed
        });
    }
    
    ret.sort((a, b) => strNumPairCompare(a.name, b.name));

    return {rects: ret, config: opt};
}

function startExporter(exporter, data, options) {
    return new Promise((resolve, reject) => {
        let {rects, config} = prepareData(data, options);
        let renderOptions = {
            rects: rects,
            config: config,
            appInfo: appInfo
        };

        // Sort the exported rows
        if(options.sortExportedRows) {
            rects = rects.sort((a, b) => {
                return smartSortImages(a.name, b.name);
            });
        }

        let sparrowOrder = window.__sparrow_order;

        // Make order the same as before
        if(sparrowOrder != null) {
            sparrowOrder = [...sparrowOrder];
            /* if(options.removeFileExtension) {
                for(let i = 0; i < sparrowOrder.length; i++) {
                    let name = sparrowOrder[i];
                    let parts = name.split(".");
                    if(parts.length > 1) parts.pop();
                    sparrowOrder[i] = parts.join(".");
                }
            } */

            let oldRects = [...rects];
            let nameMap = {};
            for (const v of rects) {
                nameMap[v.origName] = v;
            }

            let array = sparrowOrder.filter((v) => {
                return nameMap[v] !== undefined; // filter for frames which exist
            }).map(name => {
                const item = nameMap[name];
                removeFromArray(oldRects, item);
                return item;
            });

            array = array.concat(oldRects);

            rects = array;
        }

        // Fix sourceSize
        if(window.sparrowOrigMap != null) {
            for(var i = 0; i < rects.length; i++) {
                if(!window.sparrowOrigMap.hasOwnProperty(rects[i].name)) {
                    continue;
                }
                var orig = window.sparrowOrigMap[rects[i].name];
                if(orig != null) {
                    // sorry for this horrendus code
                    rects[i] = JSON.parse(JSON.stringify(rects[i]));

                    //console.log(orig);

                    rects[i].sourceSize.w = orig.frameWidth;
                    rects[i].sourceSize.h = orig.frameHeight;
                }
            }
        }

        //console.log(rects.map((v)=>v.name));

        if(rects.length) {
            rects[0].first = true;
            rects[rects.length-1].last = true;
        }

        data = rects;
        renderOptions.rects = rects;

        if(exporter.content) {
            finishExporter(exporter, renderOptions, resolve, reject);
            return;
        }

        GET("static/exporters/" + exporter.template, null, (template) => {
            exporter.content = template;
            finishExporter(exporter, renderOptions, resolve, reject);
        }, () => reject(exporter.template + " not found"));
    });
}

function finishExporter(exporter, renderOptions, resolve, reject) {
    try {
        let ret = mustache.render(exporter.content, renderOptions);
        resolve(ret);
    }
    catch(e) {
        reject(e.message);
    }
}

export {getExporterByType, startExporter};
export default list;
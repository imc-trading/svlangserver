import {
    Location,
    Position,
    Range,
    SymbolInformation,
    SymbolKind,
    TextDocument
} from "vscode-languageserver/node";

import {
    ConnectionLogger,
    fsReadFileSync,
    uriToPath
} from './genutils';

export type DefinitionLocations = Range|Array<string|Range>;
type SymbolLocation = number|Range|[string, Range];

type PositionJSON = [number, number];
type RangeJSON = [PositionJSON, PositionJSON];
type DefinitionLocationsJSON = RangeJSON|Array<string|RangeJSON>;
type SymbolLocationJSON = number|RangeJSON|[string, RangeJSON];
export type SystemVerilogSymbolJSON = [string, DefinitionLocationsJSON, SymbolLocationJSON, string[], string[]];

export class SystemVerilogSymbol {
    public name: string;
    public defLocations: DefinitionLocations;
    public symLocation: SymbolLocation;
    public containers: string[];
    public type: string[];

    constructor(name: string, defLocations: DefinitionLocations, symLocation: SymbolLocation, containers: string[], type: string[]) {
        this.name = name;
        this.defLocations = defLocations;
        this.symLocation = symLocation;
        this.containers = containers;
        this.type = type;
    }

    private static _toRangeJSON(range: Range): RangeJSON {
        return [[range.start.line, range.start.character], [range.end.line, range.end.character]];
    }

    private static _isRangeJSON(rangeJSON: DefinitionLocationsJSON|SymbolLocationJSON): Boolean {
        return (Array.isArray(rangeJSON[0])) && (typeof rangeJSON[0][0] === "number");
    }

    private static _toRange(rangeJSON: RangeJSON): Range {
        return Range.create(
            rangeJSON[0][0],
            rangeJSON[0][1],
            rangeJSON[1][0],
            rangeJSON[1][1]
        );
    }

    private static _defLocationsToJSON(defLocations: DefinitionLocations): DefinitionLocationsJSON {
        let defLocationsJSON: DefinitionLocationsJSON;
        if (Array.isArray(defLocations)) {
            defLocationsJSON = [];
            for (let defLocation of defLocations) {
                if (typeof defLocation === "string") {
                    defLocationsJSON.push(defLocation);
                }
                else {
                    defLocationsJSON.push(SystemVerilogSymbol._toRangeJSON(defLocation));
                }
            }
        }
        else {
            defLocationsJSON = SystemVerilogSymbol._toRangeJSON(defLocations);
        }
        return defLocationsJSON;
    }

    private static _symLocationToJSON(symLocation: SymbolLocation): SymbolLocationJSON {
        let symLocationJSON: SymbolLocationJSON;
        if (typeof symLocation === "number") {
            symLocationJSON = symLocation;
        }
        else if (Array.isArray(symLocation)) {
            symLocationJSON = [symLocation[0], SystemVerilogSymbol._toRangeJSON(symLocation[1])];
        }
        else {
            symLocationJSON = SystemVerilogSymbol._toRangeJSON(symLocation);
        }
        return symLocationJSON;
    }

    public toJSON(): SystemVerilogSymbolJSON {
        try {
            return [
                this.name,
                SystemVerilogSymbol._defLocationsToJSON(this.defLocations),
                SystemVerilogSymbol._symLocationToJSON(this.symLocation),
                this.containers,
                this.type
            ];
        } catch(error) {
            ConnectionLogger.error(error);
            return [
                this.name,
                [[undefined, undefined], [undefined, undefined]],
                [[undefined, undefined], [undefined, undefined]],
                this.containers,
                this.type
            ];
        }
    }

    static fromJSON(uri: string, jsonSymbol: SystemVerilogSymbolJSON): SystemVerilogSymbol {
        try {
            let defLocations: DefinitionLocations;
            if (SystemVerilogSymbol._isRangeJSON(jsonSymbol[1])) {
                defLocations = SystemVerilogSymbol._toRange(<RangeJSON>(jsonSymbol[1]));
            }
            else {
                defLocations = [];
                for (let defLocationJSON of jsonSymbol[1]) {
                    if (typeof defLocationJSON === "string") {
                        defLocations.push(defLocationJSON);
                    }
                    else {
                        defLocations.push(SystemVerilogSymbol._toRange(<RangeJSON>(defLocationJSON)));
                    }
                }
            }

            let symLocation: SymbolLocation;
            if (typeof jsonSymbol[2] === "number") {
                symLocation = jsonSymbol[2];
            }
            else if (SystemVerilogSymbol._isRangeJSON(jsonSymbol[2])) {
                symLocation = SystemVerilogSymbol._toRange(<RangeJSON>(jsonSymbol[2]));
            }
            else {
                symLocation = [<string>(jsonSymbol[2][0]), SystemVerilogSymbol._toRange(<RangeJSON>(jsonSymbol[2][1]))];
            }

            return new SystemVerilogSymbol(
                jsonSymbol[0],
                defLocations,
                symLocation,
                jsonSymbol[3],
                jsonSymbol[4]
            );
        } catch(error) {
            ConnectionLogger.error(error);
            return undefined;
        }
    }

    public getSymbolLocation(uri: string): Location {
        try {
            let symRange: Range;
            let symURI: string = uri;
            if (typeof this.symLocation === "number") {
                if (!Array.isArray(this.defLocations)) {
                    ConnectionLogger.error(`Invalid symbol location (number) when defLocations is not an array`);
                }
                let l: number = 0;
                for (let i = 0; i < (<Array<string|Range>>(this.defLocations)).length; i++) {
                    if (typeof this.defLocations[i] === "string") {
                        symURI = this.defLocations[i];
                    }
                    else if (l == this.symLocation) {
                        symRange = this.defLocations[i];
                        break;
                    }
                    else {
                        l++;
                    }
                }
            }
            else if (Array.isArray(this.symLocation)) {
                symURI = this.symLocation[0];
                symRange = this.symLocation[1];
            }
            else {
                symRange = this.symLocation;
            }

            return Location.create(symURI, symRange);
        } catch(error) {
            ConnectionLogger.error(error);
            return undefined;
        }
    }

    public toSymbolInformation(uri: string): SymbolInformation {
        try {
            let symLocation: Location = this.getSymbolLocation(uri);

            return SymbolInformation.create(
                this.name,
                getSymbolKind(this.type),
                symLocation.range,
                symLocation.uri,
                this.containers.length > 0 ? this.containers[this.containers.length - 1] : undefined
            );
        } catch(error) {
            ConnectionLogger.error(error);
            return undefined;
        }
    }

    public overwrite(symbol: SystemVerilogSymbol) {
        this.name = symbol.name;
        this.defLocations = symbol.defLocations;
        this.symLocation = symbol.symLocation;
        this.containers = symbol.containers;
        this.type = symbol.type;
    }

    public getDefinition(uri: string): string {
        return SystemVerilogSymbol.getDefinitions(uri, [this])[0];
    }

    public static getDefinitions(uri: string, symbols: SystemVerilogSymbol[]): string[] {
        try {
            let documentMap: Map<string, TextDocument> = new Map();
            let currDocument: TextDocument;
            let definitions: string[] = [];
            for (let symbol of symbols) {
                let defLocations: Array<string|Range> = Array.isArray(symbol.defLocations) ? (<Array<string|Range>>[uri]).concat(<Array<string|Range>>(symbol.defLocations)) : [uri, <Range>(symbol.defLocations)];
                let definition: string = "";
                for (let i = 0; i < defLocations.length; i++) {
                    if (typeof defLocations[i] === "string") {
                        if (documentMap.has(<string>(defLocations[i]))) {
                            currDocument = documentMap.get(<string>(defLocations[i]));
                        }
                        else {
                            let data = fsReadFileSync(uriToPath(<string>(defLocations[i])));
                            currDocument = TextDocument.create(<string>(defLocations[i]), "SystemVerilog", 0, data.toString());
                            documentMap.set(<string>(defLocations[i]), currDocument);
                        }
                    }
                    else {
                        definition = definition.concat(currDocument.getText(<Range>(defLocations[i])));
                    }
                }
                definitions.push(definition);
            }
            return definitions;
        } catch(error) {
            ConnectionLogger.error(error);
            return [];
        }
    }

    public getSymbolDocumentPath(uri: string): string {
        if (Array.isArray(this.defLocations) && (typeof this.defLocations[0] === "string")) {
            return this.defLocations[0];
        }
        return uri;
    }
}

function getSymbolKind(name: string[]): SymbolKind {
    if ((name === undefined) ||
        (name.length <= 0) ||
        (name[0] === '')) {
        return SymbolKind.Variable;
    }
    switch (name[0]) {
        case 'macro': return SymbolKind.Method;
        case 'parameter-port': return SymbolKind.Property;
        case 'port': return SymbolKind.Variable;
        case 'module': return SymbolKind.Class;
        case 'macromodule': return SymbolKind.Class;
        case 'interface': return SymbolKind.Interface;
        case 'program': return SymbolKind.Class;
        case 'package': return SymbolKind.Module;
        case 'function': return SymbolKind.Function;
        case 'task': return SymbolKind.Method;
        case 'parameter': return SymbolKind.Property;
        case 'localparam': return SymbolKind.Property;
        case 'modport': return SymbolKind.Field;
        case 'struct_union_member': return SymbolKind.Field;
        case 'struct': return SymbolKind.Struct;
        case 'union': return SymbolKind.Struct;
        case 'enum_member': return SymbolKind.EnumMember;
        case 'enum': return SymbolKind.Enum;
        case 'typedef': return SymbolKind.TypeParameter;
        case 'instance':
        case 'variable':
        default: return SymbolKind.Variable;
    }
}

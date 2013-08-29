/*global define*/
define(['../Core/createGuid',
        '../Core/Cartographic',
        '../Core/Color',
        '../Core/ClockRange',
        '../Core/ClockStep',
        '../Core/DeveloperError',
        '../Core/RuntimeError',
        '../Core/Ellipsoid',
        '../Core/Event',
        '../Core/Iso8601',
        '../Core/loadXML',
        './ConstantProperty',
        './DynamicProperty',
        './DynamicMaterialProperty',
        './DynamicClock',
        './DynamicObject',
        './DynamicObjectCollection',
        './DynamicPoint',
        './DynamicPolyline',
        './DynamicPolygon',
        './DynamicLabel',
        './DynamicBillboard',
        '../ThirdParty/when',
        '../ThirdParty/Uri',
        './processGxTour'
    ], function(
        createGuid,
        Cartographic,
        Color,
        ClockRange,
        ClockStep,
        DeveloperError,
        RuntimeError,
        Ellipsoid,
        Event,
        Iso8601,
        loadXML,
        ConstantProperty,
        DynamicProperty,
        DynamicMaterialProperty,
        DynamicClock,
        DynamicObject,
        DynamicObjectCollection,
        DynamicPoint,
        DynamicPolyline,
        DynamicPolygon,
        DynamicLabel,
        DynamicBillboard,
        when,
        Uri,
        GxTourProcessor) {
    "use strict";

    // *** ConstantPosition *** //
    var ConstantPositionProperty = function(value) {
        this._value = value;
    };

    ConstantPositionProperty.prototype.getValueCartesian = function(time, result) {
        var value = this._value;
        if (typeof value.clone === 'function') {
            return value.clone(result);
        }
        return value;
    };






    // *** KmlDataSource *** //

    var KmlDataSource = function(){
        // -- private section

        var _changed = new Event();
        var _error = new Event();
        // var _clock = undefined;
        var _dynamicObjectCollection = new DynamicObjectCollection();
        var _timeVarying = true;

        var _animation;

        var that = this;

        var loadKML = function(kml, sourceUri) {
            var dynamicObjectCollection = _dynamicObjectCollection;
            var styleCollection = new DynamicObjectCollection();

            var populatePlacemark = function(placemark) {
                var placemarkId = typeof placemark.id !== 'undefined' ? placemark.id : createGuid();
                var placemarkDynamicObject = dynamicObjectCollection.getOrCreateObject(placemarkId);

                KmlGeometryProcessor.retrievePlacemarkType(placemarkDynamicObject, placemark);

                // KmlStyleProcessor.processInlineStyles(placemarkDynamicObject, placemark, styleCollection);
                KmlStyleProcessor.applyStyles(placemarkDynamicObject, placemark, styleCollection);
                KmlGeometryProcessor.processPlacemark(that, placemarkDynamicObject, placemark);
            };

            //Since KML external styles can be asynchonous, we start off
            //by loading all styles first, before doing anything else.
            //The rest of the loading code is synchronous
            return when.all(
                KmlStyleProcessor.processStyles(kml, styleCollection),
                function() {
                    var array = kml.getElementsByTagName('Placemark');
                    for ( var i = 0, len = array.length; i < len; i++) {
                        populatePlacemark(array[i]);
                    }

                    var processor;
                    var result;
                    // process gx:Tour
                    array = kml.getElementsByTagNameNS(GxTourProcessor.GX_NS, 'Tour');
                    if (array.length === 1) {
                        processor = new GxTourProcessor();
                        processor.processTour(array[0]);
                        result = processor.getPlaylist();

                        // TBD
                        // animation = {tour: [{type: 'wait', duration: 1}, {type: 'flyTo', ....}, {}, ...]}
                        _animation = {tour: result};
                    }

                    _changed.raiseEvent(that);
                }
            );
        };




        // -- public section

        /**
         * Gets an event that will be raised when non-time-varying data changes
         * or if the return value of getIsTimeVarying changes.
         * @memberof DataSource
         *
         * @returns {Event} The event.
         */
        this.getChangedEvent = function() {
            return _changed;
        };

        /**
         * Gets an event that will be raised if an error is encountered during processing.
         * @memberof KmlDataSource
         *
         * @returns {Event} The event.
         */
        this.getErrorEvent = function() {
            return _error;
        };


        /**
         * Gets the top level clock defined in KML or the availability of the
         * underlying data if no clock is defined.  If the KML document only contains
         * infinite data, undefined will be returned.
         * @memberof KmlDataSource
         *
         * @returns {DynamicClock} The clock associated with the current KML data, or undefined if none exists.
         */
        this.getClock = function() {
            return _clock;
        };


        /**
         * Gets the DynamicObjectCollection generated by this data source.
         * @memberof DataSource
         *
         * @returns {DynamicObjectCollection} The collection of objects generated by this data source.
         */
        this.getDynamicObjectCollection = function() {
            return _dynamicObjectCollection;
        };

        /**
         * Gets a value indicating if the data varies with simulation time.  If the return value of
         * this function changes, the changed event will be raised.
         * @memberof DataSource
         *
         * @returns {Boolean} True if the data is varies with simulation time, false otherwise.
         */
        this.getIsTimeVarying = function() {
            return _timeVarying;
        };


        /**
         * !EXPERIMENTAL!
         *
         * Return animation items (if available)
         * 
         */
        this.getAnimation = function() {
            return _animation;
        };

        /**
         * Replaces any existing data with the provided KML.
         *
         * @param {Object} KML The KML to be processed.
         * @param {String} source The source of the KML.
         *
         * @exception {DeveloperError} KML is required.
         */
        this.load = function(kml, source) {
            if (typeof kml === 'undefined') {
                throw new DeveloperError('kml is required.');
            }

            _dynamicObjectCollection.clear();
            return loadKML(kml, source);
        };

        /**
         * Asynchronously loads the KML at the provided url, replacing any existing data.
         *
         * @param {Object} url The url to be processed.
         *
         * @returns {Promise} a promise that will resolve when the KML is processed.
         *
         * @exception {DeveloperError} url is required.
         */
        this.loadUrl = function(url) {
            if (typeof url === 'undefined') {
                throw new DeveloperError('url is required.');
            }

            var that = this;

            return when(loadXML(url), function(kml) {
                return that.load(kml, url);
            }, function(error) {
                _error.raiseEvent(that, error);
                return when.reject(error);
            });
        };
    };






    var KmlUtil = {
        /**
         * Allocate a new Cesium object based on a KML node.
         *
         * @param {DOM Node} kml A DOM node.
         *
         * @param {DynamicObjectCollection} dynamicObjectCollection Object store.
         *
         * @return {DynamicObject} Created object
         */
        // Seems unused
        createObject: function(kml, dynamicObjectCollection) {
            // find out ID

            var id = kml.id;
            if (typeof id === 'undefined') {
                id = createGuid();
            } else {
                var finalId = id;
                while (typeof dynamicObjectCollection.getObject(finalId) !== 'undefined') {
                    finalId = createGuid();
                }
                id = finalId;
            }

            var dynamicObject = dynamicObjectCollection.getOrCreateObject(id);
            dynamicObject.kml = kml;

            return dynamicObject;
        },

        // unused
        getId: function (node) {
            var id;
            var idNode = node.attributes.id;
            if(typeof idNode !== 'undefined') {
                id = idNode.value;
            } else {
                id = createGuid();
            }
            return id;
        }
    };




    var KmlCoordUtil = (function() {
        var that = {};

        // -- private section

        var _crs = function(coordinates) {
            var cartographic = Cartographic.fromDegrees(coordinates[0], coordinates[1], coordinates[2]);
            return Ellipsoid.WGS84.cartographicToCartesian(cartographic);
        };


        var _crsFunction = function(coordinates) {
            if (coordinates.length === 1) {
                // old crsFunction
                return _crs(coordinates[0]);
            } else {
                // coordinatesArrayToCartesianArray
                var positions = [];
                var cartographic;
                for ( var i = 0; i < coordinates.length; i++) {
                    positions.push( _crs(coordinates[i]) );
                }
                return positions;
            }
        };


        /**
         * Parse a bulk of coordinates and returns them as array.
         * 
         * @param {DOM Text Node} el A multi line DOM Text Node
         *                           containing two or three coordinates
         *                           separated by comma
         * @return {Array} of {Array} of {Numeric} Array of [c1,c2,c3] coordinates
         *         or {Array} of {Numeric} Only one tuple if only one found
         *
         * @exception {DeveloperError} Longitude and latitude are required.
         */
        that.readCoordinates = function(el) {
            var text = "", coords = [], i, k;

            for (i = 0; i < el.childNodes.length; i++) {
                text = text + el.childNodes[i].nodeValue;
            }

            // list of string -> list of float array
            // ["1,2,3", "4,5,6", ...] -> [[1,2,3], [4,5,6], ...]
            var finalCoords = text.trim().split(/[\s]+/).map( function(str) {
                return str.split(/,/).map( function(fs) {
                    return parseFloat(fs);
                });
            } );

            // post check
            for (k = 0; k < finalCoords.length; k++){
                if (isNaN(finalCoords[k][0]) || isNaN(finalCoords[k][1])) {
                    throw new DeveloperError('Longitude and latitude are required.');
                }
            }

            return finalCoords.length === 1 ? finalCoords[0] : finalCoords;
        };



        /**
         *
         * @param {Array} el Array of DOM Nodes
         *
         * @return {Array} of cartographic coordinates
         */
        that.readMultipleCoordinates = function(el) {
            var coordinates = [];
            for (var j = 0; j < el.length; j++) {
                coordinates = coordinates.concat(this.readCoordinates(el[j]));
            }
            return _crsFunction(coordinates);
        };


        return that;
    })();






    //Helper functions




    function getNumericValue(node, tagName){
        var element = node.getElementsByTagName(tagName)[0];
        var value = typeof element !== 'undefined' ? element.firstChild.data : undefined;
        return parseFloat(value, 10);
    }

    function getStringValue(node, tagName){
        var element = node.getElementsByTagName(tagName)[0];
        var value = typeof element !== 'undefined' ? element.firstChild.data : undefined;
        return value;
    }

    function getColorValue(node, tagName){
        var red, green, blue, alpha;
        var element = node.getElementsByTagName(tagName)[0];
        var colorModeNode = node.getElementsByTagName('colorMode')[0];
        var value = typeof element !== 'undefined' ? element.firstChild.data : undefined;
        if (typeof value === 'undefined'){
            return new Color(1.0, 1.0, 1.0, 1.0); //white as default?
        }
        var colorMode = typeof colorModeNode !== 'undefined' ? colorModeNode.firstChild.data : undefined;
        if(colorMode === 'random'){
            var options = {};
            options.blue = parseInt(value.substring(2,4), 16)  / 255.0;
            options.green = parseInt(value.substring(4,6), 16) / 255.0;
            options.red = parseInt(value.substring(6,8), 16) / 255.0;
            var color = Color.fromRandom(options);
            color.alpha = parseInt(value.substring(0,2), 16) / 255.0;
            return color;
        }
        //normal mode as default
        alpha = parseInt(value.substring(0,2), 16) / 255.0;
        blue = parseInt(value.substring(2,4), 16)  / 255.0;
        green = parseInt(value.substring(4,6), 16) / 255.0;
        red = parseInt(value.substring(6,8), 16) / 255.0;
        return new Color(red, green, blue, alpha);
    }




    // KML processing functions


    var KmlGeometryProcessor = {
        // geometryTypes = ['Point', 'LineString', 'LinearRing', 'Polygon', 'MultiGeometry', 'Model'],
        geometryTypes: ['Point', 'LineString', 'LinearRing', 'Polygon'],

        retrievePlacemarkType: function(dynamicObject, placemark) {
            if (dynamicObject === null || placemark === null) {
                throw new DeveloperError("Missing parameters.");
            }


            var node = (function() {
                var i, j, len = placemark.childNodes.length;
                for(i=0; i < len; i++){
                    var node = placemark.childNodes.item(i);
                    for (j=0; j<KmlGeometryProcessor.geometryTypes.length; j++) {
                        if (KmlGeometryProcessor.geometryTypes[j] === node.nodeName) {
                            return node;
                        }
                    }
                }

                throw new DeveloperError("Unable to determine placemark geometry!");
            })();

            placemark.geometry = node.nodeName;
            placemark.geomNode = node;

            return node;
        },



        /**
         * Processes placemark geometry
         *
         * @param {KmlDataSource} dataSource
         * @param {DynamicObject} dynamicObject
         * @param {DOM Element} placemark
         */
        processPlacemark: function(dataSource, dynamicObject, placemark) {
            dynamicObject.name = getStringValue(placemark, 'name');
            if(typeof dynamicObject.label !== 'undefined'){
                dynamicObject.label.text = new ConstantProperty(dynamicObject.name);
            }

            if (placemark.geometry === undefined ) {
                KmlGeometryProcessor.retrievePlacemarkType(dynamicObject, placemark);
            }

            // process geometry
            KmlGeometryProcessor['process'+placemark.geometry](dataSource, dynamicObject, placemark, placemark.geomNode);
        },

        processPoint: function(dataSource, dynamicObject, kml, node) {
            //TODO extrude, altitudeMode, gx:altitudeMode
            var el = node.getElementsByTagName('coordinates');
            /***
            var coordinates = [];
            for (var j = 0; j < el.length; j++) {
                coordinates = coordinates.concat(KmlCoordUtil.readCoordinates(el[j]));
            }
            var cartesian3 = crsFunction(coordinates);
            dynamicObject.position = new ConstantPositionProperty(cartesian3);
            **/
            dynamicObject.position = new ConstantPositionProperty( KmlCoordUtil.readMultipleCoordinates( el ) );
        },

        processLineString: function(dataSource, dynamicObject, kml, node){
            //TODO gx:altitudeOffset, extrude, tessellate, altitudeMode, gx:altitudeMode, gx:drawOrder
            var el = node.getElementsByTagName('coordinates');
            /* var coordinates = [];
            for (var j = 0; j < el.length; j++) {
                coordinates = coordinates.concat(KmlCoordUtil.readCoordinates(el[j]));
            }
            dynamicObject.vertexPositions = new ConstantPositionProperty(coordinatesArrayToCartesianArray(coordinates)); */
            dynamicObject.vertexPositions = new ConstantPositionProperty( KmlCoordUtil.readMultipleCoordinates( el ) );
        },

        processLinearRing: function(dataSource, dynamicObject, kml, node){
          //TODO gx:altitudeOffset, extrude, tessellate, altitudeMode, altitudeModeEnum
            var el = node.getElementsByTagName('coordinates');
            /*var coordinates = [];
            for (var j = 0; j < el.length; j++) {
                coordinates = coordinates.concat(KmlCoordUtil.readCoordinates(el[j]));
            }
            dynamicObject.vertexPositions = new ConstantPositionProperty(coordinatesArrayToCartesianArray(coordinates));
            */
            var coordinates = KmlCoordUtil.readMultipleCoordinates( el );
            if (coordinates[0] !== coordinates[coordinates.length - 1]){
                throw new DeveloperError("The first and last coordinate tuples must be the same.");
            }
            dynamicObject.vertexPositions = new ConstantPositionProperty(coordinates);
        },

        processPolygon: function(dataSource, dynamicObject, kml, node){
            var el = node.getElementsByTagName('coordinates');
            /* var coordinates = [];
            for (var j = 0; j < el.length; j++) {
                coordinates = coordinates.concat(KmlCoordUtil.readCoordinates(el[j]));
            } */
            var coordinates = KmlCoordUtil.readMultipleCoordinates( el );

    //        var polygon = new DynamicPolygon();
    //        polygon.material = new DynamicMaterialProperty();
    //        polygonMaterial.processCzmlIntervals({
    //            solidColor : {
    //                color : {
    //                    rgba : [255, 255, 255, 255]
    //                }
    //            }
    //        }, undefined, undefined);
    //        dynamicObject.polygon = polygon;
        }
    };





    var KmlStyleProcessor = {
        /**
         * 
         *
         * @param {KML Node}      styleNode      Source DOM node
         * @param {DynamicObject} dynamicObject  Target object
         */
        processStyle: function (styleNode, dynamicObject) {
            for(var i = 0, len = styleNode.childNodes.length; i < len; i++){
                var node = styleNode.childNodes.item(i);

                if(node.nodeName === "IconStyle"){
                    //Map style to billboard properties
                    //TODO heading, hotSpot
                    var billboard = typeof dynamicObject.billboard !== 'undefined' ? dynamicObject.billboard : new DynamicBillboard();
                    var scale = getNumericValue(node, 'scale');
                    var icon = getStringValue(node,'href');
                    var color = getColorValue(node, 'color');

                    billboard.image = typeof icon !== 'undefined' ? new ConstantProperty(icon) : undefined;
                    billboard.scale = typeof scale !== 'undefined' ? new ConstantProperty(scale) : undefined;
                    billboard.color = typeof color !== 'undefined' ? new ConstantProperty(color) : undefined;
                    dynamicObject.billboard = billboard;
                }
                else if(node.nodeName ===  "LabelStyle")   {
                    //Map style to label properties
                    var label = typeof dynamicObject.label !== 'undefined' ? dynamicObject.label : new DynamicLabel();
                    var labelScale = getNumericValue(node, 'scale');
                    var labelColor = getColorValue(node, 'color');

                    label.scale = typeof labelScale !== 'undefined' ? new ConstantProperty(labelScale) : undefined;
                    label.fillColor = typeof labelColor !== 'undefined' ? new ConstantProperty(labelColor) : undefined;
                    label.text = typeof dynamicObject.name !== 'undefined' ? new ConstantProperty(dynamicObject.name) : undefined;
                    dynamicObject.label = label;
                }
                else if(node.nodeName ===  "LineStyle")   {
                    //Map style to line properties
                    //TODO PhysicalWidth, Visibility
                    var polyline = typeof dynamicObject.polyline !== 'undefined' ? dynamicObject.polyline : new DynamicPolyline();
                    var lineColor = getColorValue(node, 'color');
                    var lineWidth = getNumericValue(node,'width');
                    var lineOuterColor = getColorValue(node,'outerColor');
                    var lineOuterWidth = getNumericValue(node,'outerWidth');

                    polyline.color = typeof lineColor !== 'undefined' ? new ConstantProperty(lineColor) : undefined;
                    polyline.width = typeof lineWidth !== 'undefined' ? new ConstantProperty(lineWidth) : undefined;
                    polyline.outlineColor = typeof lineOuterColor !== 'undefined' ? new ConstantProperty(lineOuterColor) : undefined;
                    polyline.outlineWidth = typeof lineOuterWidth !== 'undefined' ? new ConstantProperty(lineOuterWidth) : undefined;
                    dynamicObject.polyline = polyline;
                }
                else if(node.nodeName === "PolyStyle")   {
                    dynamicObject.polygon = typeof dynamicObject.polygon !== 'undefined' ? dynamicObject.polygon : new DynamicPolygon();
                    //Map style to polygon properties
                    //TODO Fill, Outline
    //                var polygonMaterial = new DynamicMaterialProperty();
    //                var polyline = new DynamicPolyline();
    //                polyline.color = new ConstantProperty(Color.WHITE);
    //                polyline.width = new ConstantProperty(1);
    //                polyline.outlineColor = new ConstantProperty(Color.BLACK);
    //                polyline.outlineWidth = new ConstantProperty(0);
    //                dinamicObject.polyline = polyline;
    //                dynamicObject.polygon.material = polygonMaterial;
    //                polygonMaterial.processCzmlIntervals({
    //                    solidColor : {
    //                        color : {
    //                            rgba : [255, 255, 0, 25]
    //                        }
    //                    }
    //                }, undefined, undefined);
                }
            }
        },

        /**
         * Processes and merges any inline styles for the provided node into
         * the provided dynamic object.
         *
         * @param {DynamicObject}  dynamicObject    Target object
         * @param {KML Node}       node             Source DOM Node
         * @param {Array}          styleCollection  Collection of shared styles
         */
        processInlineStyles: function(dynamicObject, node, styleCollection) {
            //KML_TODO Validate the behavior for multiple/conflicting styles.
            var inlineStyles = node.getElementsByTagName('Style');
            var inlineStylesLength = inlineStyles.length;
            if (inlineStylesLength > 0) {
                //Google earth seems to always use the last inline style only.
                KmlStyleProcessor.processStyle(inlineStyles.item(inlineStylesLength - 1), dynamicObject);
            }

            var externalStyles = node.getElementsByTagName('styleUrl');
            if (externalStyles.length > 0) {
                var styleObject = styleCollection.getObject(externalStyles.item(0).textContent);
                if (typeof styleObject !== 'undefined') {
                    //Google earth seems to always use the first external style only.
                    DynamicBillboard.mergeProperties(dynamicObject, styleObject);
                    DynamicLabel.mergeProperties(dynamicObject, styleObject);
                    DynamicPoint.mergeProperties(dynamicObject, styleObject);
                    DynamicPolygon.mergeProperties(dynamicObject, styleObject);
                    DynamicPolyline.mergeProperties(dynamicObject, styleObject);
                    DynamicObject.mergeProperties(dynamicObject, styleObject);
                }
            }
        },


        /**
         * Apply styles to placemark
         *
         * @param {DynamicObject}            dynamicObject    Target object
         * @param {KML Node}                 kmlNode          Original Placemark object
         * @param {DynamicObjectCollection}  styleCollection  Collection of shared styles
         */
        applyStyles: function(dynamicObject, kmlNode, styleCollection) {
            //KML_TODO Validate the behavior for multiple/conflicting styles.
            var styleObj = new DynamicObject();

            // collect all styles and apply a pure object
            KmlStyleProcessor.processInlineStyles(styleObj, kmlNode, styleCollection);

            // now carefully select and apply the only needed ones
            // ['Point', 'LineString', 'LinearRing', 'Polygon']
            switch (kmlNode.geometry) {
                case 'Point':
                    DynamicBillboard.mergeProperties(dynamicObject, styleObj);
                    break;
                case 'LinearRing':
                    // FIXME - should be handled together with polygons
                    break;
                case 'LineString':
                    DynamicPolyline.mergeProperties(dynamicObject, styleObj);
                    break;
                case 'Polygon':
                    DynamicPolygon.mergeProperties(dynamicObject, styleObj);
                    break;
                default:
                    // No such type
                    break;
            }
            // ??
            DynamicPoint.mergeProperties(dynamicObject, styleObj);
            DynamicObject.mergeProperties(dynamicObject, styleObj);
        },


        //Asynchronously processes an external style file.
        processExternalStyles: function(uri, styleCollection) {
            return when(loadXML(uri), function(styleKml) {
                return KmlStyleProcessor.processStyles(styleKml, styleCollection, uri);
            });
        },

        //Processes all shared and external styles and stores
        //their id into the provided styleCollection.
        //Returns an array of promises that will resolve when
        //each style is loaded.
        // @return {Array} of promises
        processStyles: function (kml, styleCollection, sourceUri) {
            var i;

            // Step #1 - process Style nodes
            var styleNodes = kml.getElementsByTagName('Style');
            var styleNodesLength = styleNodes.length;
            for (i = styleNodesLength - 1; i >= 0; i--) {
                var node = styleNodes.item(i);
                var attributes = node.attributes;
                var id = typeof attributes.id !== 'undefined' ? attributes.id.textContent : undefined;
                if (typeof id !== 'undefined') {
                    id = '#' + id;
                    if (typeof sourceUri !== 'undefined') {
                        id = sourceUri + id;
                    }
                    if (typeof styleCollection.getObject(id) === 'undefined') {
                        var styleObject = styleCollection.getOrCreateObject(id);
                        KmlStyleProcessor.processStyle(node, styleObject);
                    }
                }
            }

            // Step #2 - process styleUrl referred external styles
            var externalStyleHash = {};
            var promises = [];
            var styleUrlNodes = kml.getElementsByTagName('styleUrl');
            var styleUrlNodesLength = styleUrlNodes.length;
            var baseUri = new Uri(document.location.href);
            for (i = 0; i < styleUrlNodesLength; i++) {
                var styleReference = styleUrlNodes[i].textContent;
                if (styleReference[0] !== '#') {
                    var tokens = styleReference.split('#');
                    if (tokens.length !== 2) {
                        throw new RuntimeError();
                    }
                    var uri = tokens[0];
                    if (typeof externalStyleHash[uri] === 'undefined') {
                        if (typeof sourceUri !== 'undefined') {
                            sourceUri = new Uri(sourceUri);
                            uri = new Uri(uri).resolve(sourceUri.resolve(baseUri)).toString();
                        }
                        promises.push(KmlStyleProcessor.processExternalStyles(uri, styleCollection));
                    }
                }
            }

            return promises;
        }
    };







    /**
     * A {@link DataSource} which processes KML.
     * @alias KmlDataSource
     * @constructor
     */
    return KmlDataSource;
});
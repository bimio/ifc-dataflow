define(['backbone', 'Workspace', 'ConnectionView', 'MarqueeView', 'NodeViewTypes'], function(Backbone, Workspace, ConnectionView, MarqueeView, NodeViewTypes){

  return Backbone.View.extend({

    tagName: 'div',
    className: 'workspace_container row',

    initialize: function(atts) { 

      this.nodeViews = {};
      this.connectionViews = {};

      this.app = this.model.app;

      this.$workspace = $('<div/>', {class: 'workspace'});

      this.$workspace_back = $('<div/>', {class: 'workspace_back'});
      this.$workspace_canvas = $('<svg class="workspace_canvas" xmlns="http://www.w3.org/2000/svg" version="1.1" />');

      this.$el.append( this.$workspace );
      this.$workspace.append( this.$workspace_back );
      this.$workspace.append( this.$workspace_canvas );

      var that = this;

      this.listenTo(this.model, 'change:connections', function() {
        that.cleanup().renderConnections();
      });

      this.model.on('change:zoom', this.updateZoom, this );
      this.model.on('change:offset', this.updateOffset, this );
      this.model.on('change:isRunning', this.renderRunnerStatus, this);

      this.listenTo(this.model, 'change:nodes', function() {
        that.cleanup().renderNodes();
      });

      this.listenTo(this.model, 'change:current', this.onChangeCurrent );

      this.listenTo(this.model, 'startProxyDrag', this.startProxyDrag);
      this.listenTo(this.model, 'endProxyDrag', this.endProxyDrag);

      this.renderProxyConnection();
      this.renderMarquee();

      this.renderRunnerStatus();

      this.$el.bind('mousewheel DOMMouseScroll MozMousePixelScroll',function(e){

        this.isMouseWheel = true;
        this.clientX = e.clientX;
        this.clientY = e.clientY;

        var delta = 0;

        if ( e.originalEvent.wheelDelta !== undefined ) { // WebKit / Opera / Explorer 9
          delta = e.originalEvent.wheelDelta;
        } else if ( e.originalEvent.detail !== undefined ) { // Firefox
          delta = -e.originalEvent.detail;
        }

        if( delta > 0 ) {
            if (this.model.get('zoom') < 1) 
              this.model.set('zoom', Math.min(1, this.model.get('zoom') + delta * 0.0005 ));
        } else {
            if (this.model.get('zoom') > 0.25) 
              this.model.set('zoom', Math.max( 0.25, this.model.get('zoom') + delta * 0.0005 ));
        }

        this.isMouseWheel = false;

        return false;
      }.bind(this));
      
    },

    events: {
      'mousedown .workspace_back':  'deselectAll',
      'mousedown .workspace_back':  'startWorkspaceDrag',
      'dblclick .workspace_back':  'showNodeSearch'
    },

    render: function() {

      return this
              .cleanup()
              .renderNodes()
              .renderConnections()
              .renderNodes()
              .renderRunnerStatus()
              .updateZoom()
              .updateOffset();
    },

    startWorkspaceDrag: function(event){
      this.deselectAll();

      if (event.ctrlKey || event.which === 2){
        this.startWorkspacePan(event);
      } else {
        this.startMarqueeDrag(event);
      }
    },

    // workspace panning

    panStart: [0,0],

    startWorkspacePan: function(event){
      event.preventDefault();

      this.panStart = [ event.pageX,  event.pageY ];
      this.scrollStart = [ this.$el.scrollLeft(), this.$el.scrollTop() ];
      
      this.$workspace.bind('mousemove', $.proxy( this.workspacePan, this) );
      this.$workspace.bind('mouseup', $.proxy( this.endWorkspacePan, this) );
    },

    endWorkspacePan: function(event){
      this.model.set('offset', [this.$el.scrollLeft(), this.$el.scrollTop()])
      this.$workspace.unbind('mousemove', this.workspacePan);
      this.$workspace.unbind('mouseup', this.endWorkspacePan);
    },

    workspacePan: function(event){
      this.$el.scrollLeft( this.scrollStart[0] + this.panStart[0] - event.pageX );
      this.$el.scrollTop( this.scrollStart[1] + this.panStart[1] - event.pageY );
    },

    // marquee drag

    startMarqueeDrag: function(event){
      var offset = this.$workspace.offset()
        , zoom = this.model.get('zoom')
        , posInWorkspace = [ (1 / zoom) * (event.pageX - offset.left), (1 / zoom) * ( event.pageY - offset.top) ];

      this.model.marquee.setStartCorner( posInWorkspace );
      
      this.$workspace.bind('mousemove', $.proxy( this.marqueeDrag, this) );
      this.$workspace.bind('mouseup', $.proxy( this.endMarqueeDrag, this) );
    },

    endMarqueeDrag: function(event){
      this.model.marquee.set('hidden', true);
      this.$workspace.unbind('mousemove', this.marqueeDrag);
      this.$workspace.unbind('mouseup', this.endMarqueeDrag);
    },

    marqueeDrag: function(event){

      this.model.marquee.set('hidden', false);

      var offset = this.$workspace.offset()
        , zoom = this.model.get('zoom')
        , posInWorkspace = [ (1 / zoom) * (event.pageX - offset.left), (1 / zoom) * ( event.pageY - offset.top) ];

      this.model.marquee.setEndCorner( posInWorkspace );
      this.doMarqueeSelect();

    },

    doMarqueeSelect: function(){

      var x1 = this.model.marquee.get('x')
        , y1 = this.model.marquee.get('y')
        , x2 = this.model.marquee.get('x') + this.model.marquee.get('width')
        , y2 = this.model.marquee.get('y') + this.model.marquee.get('height');

      for (var nodeId in this.nodeViews ){ 

        var node = this.nodeViews[nodeId];

        var w = node.$el.width();
        var h = node.$el.height();

        var px = node.model.get('position');
        var x = px[0], y = px[1];

        var corners = [ [x, y], [x + w, y], [x + w, y + h], [x, y + h] ];

        var cornerIn = false;

        corners.forEach(function(c){

          var cx = c[0], cy = c[1];
          if ( cx < x2 && cx > x1 && cy > y1 && cy < y2 ) {
            cornerIn = true;
          }

        });

        if (cornerIn && !node.model.get('selected') ){
          node.model.set('selected', true);
        } else if ( !cornerIn && node.model.get('selected') ){
          node.model.set('selected', false);
        }

      }

    },

    getCenter: function(){

      var w = this.$el.width()
        , h = this.$el.height()
        , ho = this.$el.scrollTop()
        , wo = this.$el.scrollLeft()
        , zoom = 1 / this.model.get('zoom');

      return [zoom * (wo + w / 2), zoom * (ho + h / 2)];

    },

    updateZoom: function(){

      if (this.model.get('zoom') < 0) {
        this.model.set('zoom', 0.25); 
        return this;
      }

      if (this.cachedZoom === this.model.get('zoom')) {
        return this;
      }

      this.zoomFactor = this.model.get('zoom') / (this.cachedZoom ? this.cachedZoom : this.model.get('zoom') );
      this.cachedZoom = this.model.get('zoom');

      this.$workspace.css('transform', 'scale(' + this.model.get('zoom') + ')' );
      this.$workspace.css('transform-origin', "0 0" );

      // get scroll here, because it gets removed by the following lines
      if (this.isMouseWheel){
        var s = this.getNewScroll( this.clientX, this.clientY );
      } else {
        var s = this.getNewScroll();
      }

      this.model.set('offset', s);

      return this;

    },

    getNewScroll: function(x, y){

      var z = this.zoomFactor;
      var ox = this.model.get('offset')[0];
      var oy = this.model.get('offset')[1];

      if (!x || !y){
        var w = this.$el.width();
        var h = this.$el.height();

        // this is the offset from the center in document coordinates
        var centerOffset = [w / 2, h / 2]; 
      } else {
        var centerOffset = [x,y];
      }

      var sx = z * ( ox + centerOffset[0] ) - centerOffset[0];
      var sy = z * ( oy + centerOffset[1] ) - centerOffset[1];

      if (sx < 0) sx = 0;
      if (sy < 0) sy = 0;

      return [sx,sy];
    },

    boundingBox: function(){

      // build list of nodeViews in ws
      var nvs = [];
      for (var nv in this.nodeViews){ 
        nvs.push( this.nodeViews[nv] ); 
      }

      return nvs.reduce(function(a, x){

        var p = x.model.get('position');
        var nw = x.$el.width();
        var nh = x.$el.height();

        return [  Math.min(p[0], a[0]), 
                  Math.max(p[0] + nw, a[1]),
                  Math.min(p[1], a[2]),
                  Math.max(p[1] + nh, a[3]) ];

      }, [ Number.MAX_VALUE, 0, Number.MAX_VALUE, 0 ] ); // minx, maxx, miny, maxy

    },

    zoomAll: function(){

      var bb = this.boundingBox();

      // this is the min offset we expect from the bounding box in document space
      var o = 20 * (1 / this.model.get('zoom') );
      bb = [bb[0] - o, bb[1] + o, bb[2] - o, bb[3] + o ];

      // calculate zoom

      // we do this by first determining the width and height of the ws
      var wsw = this.$el.width();
      var wsh = this.$el.height();

      // now we determine the width of the node collection
      var ntw = bb[1] - bb[0];
      var nth = bb[3] - bb[2];

      // we calculate the zoom from the ratio between the node bbox and workspace size
      var zx = wsw / ntw;
      var zy = wsh / nth;
      var nz = Math.min( zx, zy ); // the new zoom is the lesser of these two - TODO account for zoom min

      nz = Math.min(1, nz);

      // set the zoom
      this.model.set('zoom', nz );

      // set the offset, taking into account the new zoom
      var offset = [ nz * bb[0], nz * bb[2] ];
      this.model.set('offset', offset);

    },

    updateOffset: function(){

      var s = this.model.get('offset');

      this.$el.scrollLeft( s[0] );
      this.$el.scrollTop( s[1] );

      return this;

    },

    $runnerStatus : undefined,
    runnerTemplate : _.template( $('#workspace-runner-status-template').html() ),
    renderRunnerStatus: function(){

      // placeholder for future work
      return this;

    },

    showNodeSearch: function(e){
      this.app.set('showingSearch', true);

      // the position of the click in workspace coordinates
      var z = 1 / this.model.get('zoom');
      var offX  = z * (e.clientX + this.$el.scrollLeft());
      var offY  = z * (e.clientY + this.$el.scrollTop());

      this.app.newNodePosition = [offX, offY];
    },

    startProxyDrag: function(event){
      this.$workspace.bind('mousemove', $.proxy( this.proxyDrag, this) );
      this.$workspace.bind('mouseup', $.proxy( this.endProxyDrag, this) );
    },

    endProxyDrag: function(event){
      this.$workspace.unbind('mousemove', this.proxyDrag);
      this.$workspace.unbind('mouseup', this.endProxyDrag);
      this.model.endProxyConnection();
    },

    proxyDrag: function(event){
      var offset = this.$workspace.offset()
        , zoom = this.model.get('zoom')
        , posInWorkspace = [ (1 / zoom) * (event.pageX - offset.left), (1 / zoom) * ( event.pageY - offset.top) ];

      this.model.proxyConnection.set('endProxyPosition', posInWorkspace);
    },

    renderProxyConnection: function() {

      var view = new ConnectionView({ 
        model: this.model.proxyConnection, 
        workspaceView: this, 
        workspace: this.model, 
        isProxy: true
      });

      view.render();
      this.$workspace_canvas.prepend( view.el );

    },

    renderMarquee: function() {

      var view = new MarqueeView({ 
        model: this.model.marquee, 
        workspaceView: this, 
        workspace: this.model
      });

      view.render();
      this.$workspace_canvas.prepend( view.el );

    },

    cleanup: function() {
      this.clearDeadNodes();
      this.clearDeadConnections();
      return this;
    },

    renderNodes: function() {

      var this_ = this;

      this.model.get('nodes').each(function(nodeModel) {

        var nodeView = this_.nodeViews[nodeModel.get('_id')];

        // if NodeView has not been drawn
        if ( nodeView === undefined){

          var NodeView = NodeViewTypes.Base;
          if ( NodeViewTypes[ nodeModel.get('typeName') ] != undefined)
          {
            NodeView = NodeViewTypes[ nodeModel.get('typeName') ];
          }
          nodeView = new NodeView({ model: nodeModel, workspaceView: this_, workspace: this_.model });
          this_.nodeViews[ nodeView.model.get('_id') ] = nodeView;

          this_.$workspace.prepend( nodeView.$el );
          nodeView.render();
          nodeView.makeDraggable();
          nodeView.delegateEvents();
          
          this_.$workspace_canvas.append( nodeView.portGroup );

        }

      });

      return this;

    },

    keydownHandler: function(e){

      var isBackspaceOrDelete = e.keyCode === 46 || e.keyCode === 8;

      if ( !(e.metaKey || e.ctrlKey) && !isBackspaceOrDelete ) return;

      // do not capture from input
      if (e.originalEvent.srcElement && e.originalEvent.srcElement.nodeName === "INPUT") return;
      if (e.target.nodeName === "INPUT") return;

      // keycodes: http://css-tricks.com/snippets/javascript/javascript-keycodes/

      switch (e.keyCode) {
        case 8:
          this.model.removeSelected();
          return e.preventDefault();
        case 46:
          this.model.removeSelected();
          return e.preventDefault();
        case 61:
        case 187:
          this.model.zoomIn();
          return e.preventDefault();
        case 189:
        case 173:
          this.model.zoomOut();
          return e.preventDefault();
        case 67:
          this.model.copy();
          return e.preventDefault();
        case 86:
          this.model.paste();
          return e.preventDefault();
        case 88:
          this.model.copy();
          this.model.removeSelected();
          return e.preventDefault();
        case 89:
          this.model.redo();
          return e.preventDefault();
        case 90:
          this.model.undo();
          return e.preventDefault();
      }

    },

    renderConnections: function() {

      var this_ = this;

      this.model.get('connections').forEach( function( cntn ) {

        var view = this_.connectionViews[cntn.get('_id')]

        if ( this_.connectionViews[cntn.get('_id')] === undefined){
          view = new ConnectionView({ model: cntn, workspaceView: this_, workspace: this_.model });
        }

        view.delegateEvents();

        if (!view.el.parentNode){

          view.render();
          this_.$workspace_canvas.prepend( view.el );

          this_.connectionViews[ view.model.get('_id') ] = view;
        }

      });

      return this;

    },

    clearDeadNodes: function() {

      for (var key in this.nodeViews){
        if (this.model.get('nodes').get(key) === undefined){
          this.nodeViews[key].remove();
          delete this.nodeViews[key];
        }
      }

    },

    clearDeadConnections: function() {
      for (var key in this.connectionViews){
        if (this.model.get('connections').get(key) === undefined){
          this.connectionViews[key].remove();
          delete this.connectionViews[key];
        }
      }
    },

    onRemove: function(){
      this.get('nodes').forEach(function(n){
        if (n.onRemove) n.onRemove();
      })
    },

    deselectAll: function() {
      this.model.get('nodes').deselectAll();
    },

  });
});

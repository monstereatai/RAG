import { Empty, Spin } from 'antd';
import * as d3 from 'd3';
import React, { useEffect, useRef } from 'react';
import type { GraphEdge, GraphNode } from '../service';

interface GraphVisualizationProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading?: boolean;
  height?: number;
}

const typeColorMap: Record<string, string> = {
  Person: '#1677ff',
  Organization: '#722ed1',
  Technology: '#13c2c2',
  Concept: '#52c41a',
  Document: '#1677ff',
  Category: '#fa8c16',
  Tag: '#9254de',
  Location: '#fa8c16',
  Event: '#eb2f96',
};

const getColor = (type: string) => typeColorMap[type] ?? '#8c8c8c';

const GraphVisualization: React.FC<GraphVisualizationProps> = ({
  nodes,
  edges,
  loading = false,
  height = 500,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasData = nodes.length > 0;

  useEffect(() => {
    if (!svgRef.current || !nodes.length) {
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = containerRef.current?.clientWidth ?? 800;

    const simulation = d3
      .forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force(
        'link',
        d3
          .forceLink(edges)
          .id((d: any) => d.id)
          .distance(100),
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    const g = svg.append('g');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Edges
    const link = g
      .append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', '#d9d9d9')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.8);

    // Edge labels
    const linkLabel = g
      .append('g')
      .selectAll('text')
      .data(edges)
      .join('text')
      .text((d) => d.label)
      .attr('font-size', 10)
      .attr('fill', '#8c8c8c')
      .attr('text-anchor', 'middle');

    // Nodes
    const node = g.append('g').selectAll('g').data(nodes).join('g') as any;

    const dragBehavior = d3
      .drag<SVGGElement, any>()
      .on('start', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event: any, d: any) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(dragBehavior);

    node
      .append('circle')
      .attr('r', 12)
      .attr('fill', (d: any) => getColor(d.type))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    node
      .append('text')
      .text((d: any) => d.label)
      .attr('font-size', 11)
      .attr('dx', 16)
      .attr('dy', 4)
      .attr('fill', '#333');

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      linkLabel
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, height]);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height,
        }}
      >
        <Spin description="加载图谱数据中..." />
      </div>
    );
  }

  if (!hasData) {
    return <Empty description="暂无图谱数据" />;
  }

  return (
    <div
      ref={containerRef}
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <svg ref={svgRef} width="100%" height={height} />
    </div>
  );
};

export default GraphVisualization;

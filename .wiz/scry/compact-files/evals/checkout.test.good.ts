import { describe, expect, it } from "bun:test";
import { Checkout } from "./checkout";

describe("Checkout", () => {
	it("totals a cart of 0 items", () => {
		expect(new Checkout(0).total()).toBe(0);
	});

	it("totals a cart of 1 items", () => {
		expect(new Checkout(1).total()).toBe(3);
	});

	it("totals a cart of 2 items", () => {
		expect(new Checkout(2).total()).toBe(6);
	});

	it("totals a cart of 3 items", () => {
		expect(new Checkout(3).total()).toBe(9);
	});

	it("totals a cart of 4 items", () => {
		expect(new Checkout(4).total()).toBe(12);
	});

	it("totals a cart of 5 items", () => {
		expect(new Checkout(5).total()).toBe(15);
	});

	it("totals a cart of 6 items", () => {
		expect(new Checkout(6).total()).toBe(18);
	});

	it("totals a cart of 7 items", () => {
		expect(new Checkout(7).total()).toBe(21);
	});

	it("totals a cart of 8 items", () => {
		expect(new Checkout(8).total()).toBe(24);
	});

	it("totals a cart of 9 items", () => {
		expect(new Checkout(9).total()).toBe(27);
	});

	it("totals a cart of 10 items", () => {
		expect(new Checkout(10).total()).toBe(30);
	});

	it("totals a cart of 11 items", () => {
		expect(new Checkout(11).total()).toBe(33);
	});

	it("totals a cart of 12 items", () => {
		expect(new Checkout(12).total()).toBe(36);
	});

	it("totals a cart of 13 items", () => {
		expect(new Checkout(13).total()).toBe(39);
	});

	it("totals a cart of 14 items", () => {
		expect(new Checkout(14).total()).toBe(42);
	});

	it("totals a cart of 15 items", () => {
		expect(new Checkout(15).total()).toBe(45);
	});

	it("totals a cart of 16 items", () => {
		expect(new Checkout(16).total()).toBe(48);
	});

	it("totals a cart of 17 items", () => {
		expect(new Checkout(17).total()).toBe(51);
	});

	it("totals a cart of 18 items", () => {
		expect(new Checkout(18).total()).toBe(54);
	});

	it("totals a cart of 19 items", () => {
		expect(new Checkout(19).total()).toBe(57);
	});

	it("totals a cart of 20 items", () => {
		expect(new Checkout(20).total()).toBe(60);
	});

	it("totals a cart of 21 items", () => {
		expect(new Checkout(21).total()).toBe(63);
	});

	it("totals a cart of 22 items", () => {
		expect(new Checkout(22).total()).toBe(66);
	});

	it("totals a cart of 23 items", () => {
		expect(new Checkout(23).total()).toBe(69);
	});

	it("totals a cart of 24 items", () => {
		expect(new Checkout(24).total()).toBe(72);
	});

	it("totals a cart of 25 items", () => {
		expect(new Checkout(25).total()).toBe(75);
	});

	it("totals a cart of 26 items", () => {
		expect(new Checkout(26).total()).toBe(78);
	});

	it("totals a cart of 27 items", () => {
		expect(new Checkout(27).total()).toBe(81);
	});

	it("totals a cart of 28 items", () => {
		expect(new Checkout(28).total()).toBe(84);
	});

	it("totals a cart of 29 items", () => {
		expect(new Checkout(29).total()).toBe(87);
	});

	it("totals a cart of 30 items", () => {
		expect(new Checkout(30).total()).toBe(90);
	});

	it("totals a cart of 31 items", () => {
		expect(new Checkout(31).total()).toBe(93);
	});

	it("totals a cart of 32 items", () => {
		expect(new Checkout(32).total()).toBe(96);
	});

	it("totals a cart of 33 items", () => {
		expect(new Checkout(33).total()).toBe(99);
	});

	it("totals a cart of 34 items", () => {
		expect(new Checkout(34).total()).toBe(102);
	});

	it("totals a cart of 35 items", () => {
		expect(new Checkout(35).total()).toBe(105);
	});

	it("totals a cart of 36 items", () => {
		expect(new Checkout(36).total()).toBe(108);
	});

	it("totals a cart of 37 items", () => {
		expect(new Checkout(37).total()).toBe(111);
	});

	it("totals a cart of 38 items", () => {
		expect(new Checkout(38).total()).toBe(114);
	});

	it("totals a cart of 39 items", () => {
		expect(new Checkout(39).total()).toBe(117);
	});

	it("totals a cart of 40 items", () => {
		expect(new Checkout(40).total()).toBe(120);
	});

	it("totals a cart of 41 items", () => {
		expect(new Checkout(41).total()).toBe(123);
	});

	it("totals a cart of 42 items", () => {
		expect(new Checkout(42).total()).toBe(126);
	});

	it("totals a cart of 43 items", () => {
		expect(new Checkout(43).total()).toBe(129);
	});

	it("totals a cart of 44 items", () => {
		expect(new Checkout(44).total()).toBe(132);
	});

	it("totals a cart of 45 items", () => {
		expect(new Checkout(45).total()).toBe(135);
	});

	it("totals a cart of 46 items", () => {
		expect(new Checkout(46).total()).toBe(138);
	});

	it("totals a cart of 47 items", () => {
		expect(new Checkout(47).total()).toBe(141);
	});

	it("totals a cart of 48 items", () => {
		expect(new Checkout(48).total()).toBe(144);
	});

	it("totals a cart of 49 items", () => {
		expect(new Checkout(49).total()).toBe(147);
	});

	it("totals a cart of 50 items", () => {
		expect(new Checkout(50).total()).toBe(150);
	});

	it("totals a cart of 51 items", () => {
		expect(new Checkout(51).total()).toBe(153);
	});

	it("totals a cart of 52 items", () => {
		expect(new Checkout(52).total()).toBe(156);
	});

	it("totals a cart of 53 items", () => {
		expect(new Checkout(53).total()).toBe(159);
	});

	it("totals a cart of 54 items", () => {
		expect(new Checkout(54).total()).toBe(162);
	});

	it("totals a cart of 55 items", () => {
		expect(new Checkout(55).total()).toBe(165);
	});

	it("totals a cart of 56 items", () => {
		expect(new Checkout(56).total()).toBe(168);
	});

	it("totals a cart of 57 items", () => {
		expect(new Checkout(57).total()).toBe(171);
	});

	it("totals a cart of 58 items", () => {
		expect(new Checkout(58).total()).toBe(174);
	});

	it("totals a cart of 59 items", () => {
		expect(new Checkout(59).total()).toBe(177);
	});

	it("totals a cart of 60 items", () => {
		expect(new Checkout(60).total()).toBe(180);
	});

	it("totals a cart of 61 items", () => {
		expect(new Checkout(61).total()).toBe(183);
	});

	it("totals a cart of 62 items", () => {
		expect(new Checkout(62).total()).toBe(186);
	});

	it("totals a cart of 63 items", () => {
		expect(new Checkout(63).total()).toBe(189);
	});

	it("totals a cart of 64 items", () => {
		expect(new Checkout(64).total()).toBe(192);
	});

	it("totals a cart of 65 items", () => {
		expect(new Checkout(65).total()).toBe(195);
	});

	it("totals a cart of 66 items", () => {
		expect(new Checkout(66).total()).toBe(198);
	});

	it("totals a cart of 67 items", () => {
		expect(new Checkout(67).total()).toBe(201);
	});

	it("totals a cart of 68 items", () => {
		expect(new Checkout(68).total()).toBe(204);
	});

	it("totals a cart of 69 items", () => {
		expect(new Checkout(69).total()).toBe(207);
	});

	it("totals a cart of 70 items", () => {
		expect(new Checkout(70).total()).toBe(210);
	});

	it("totals a cart of 71 items", () => {
		expect(new Checkout(71).total()).toBe(213);
	});

	it("totals a cart of 72 items", () => {
		expect(new Checkout(72).total()).toBe(216);
	});

	it("totals a cart of 73 items", () => {
		expect(new Checkout(73).total()).toBe(219);
	});

	it("totals a cart of 74 items", () => {
		expect(new Checkout(74).total()).toBe(222);
	});

	it("totals a cart of 75 items", () => {
		expect(new Checkout(75).total()).toBe(225);
	});

	it("totals a cart of 76 items", () => {
		expect(new Checkout(76).total()).toBe(228);
	});

	it("totals a cart of 77 items", () => {
		expect(new Checkout(77).total()).toBe(231);
	});

	it("totals a cart of 78 items", () => {
		expect(new Checkout(78).total()).toBe(234);
	});

	it("totals a cart of 79 items", () => {
		expect(new Checkout(79).total()).toBe(237);
	});

	it("totals a cart of 80 items", () => {
		expect(new Checkout(80).total()).toBe(240);
	});

	it("totals a cart of 81 items", () => {
		expect(new Checkout(81).total()).toBe(243);
	});

	it("totals a cart of 82 items", () => {
		expect(new Checkout(82).total()).toBe(246);
	});

	it("totals a cart of 83 items", () => {
		expect(new Checkout(83).total()).toBe(249);
	});

	it("totals a cart of 84 items", () => {
		expect(new Checkout(84).total()).toBe(252);
	});

	it("totals a cart of 85 items", () => {
		expect(new Checkout(85).total()).toBe(255);
	});

	it("totals a cart of 86 items", () => {
		expect(new Checkout(86).total()).toBe(258);
	});

	it("totals a cart of 87 items", () => {
		expect(new Checkout(87).total()).toBe(261);
	});

	it("totals a cart of 88 items", () => {
		expect(new Checkout(88).total()).toBe(264);
	});

	it("totals a cart of 89 items", () => {
		expect(new Checkout(89).total()).toBe(267);
	});

	it("totals a cart of 90 items", () => {
		expect(new Checkout(90).total()).toBe(270);
	});

	it("totals a cart of 91 items", () => {
		expect(new Checkout(91).total()).toBe(273);
	});

	it("totals a cart of 92 items", () => {
		expect(new Checkout(92).total()).toBe(276);
	});

	it("totals a cart of 93 items", () => {
		expect(new Checkout(93).total()).toBe(279);
	});

	it("totals a cart of 94 items", () => {
		expect(new Checkout(94).total()).toBe(282);
	});

	it("totals a cart of 95 items", () => {
		expect(new Checkout(95).total()).toBe(285);
	});

	it("totals a cart of 96 items", () => {
		expect(new Checkout(96).total()).toBe(288);
	});

	it("totals a cart of 97 items", () => {
		expect(new Checkout(97).total()).toBe(291);
	});

	it("totals a cart of 98 items", () => {
		expect(new Checkout(98).total()).toBe(294);
	});

	it("totals a cart of 99 items", () => {
		expect(new Checkout(99).total()).toBe(297);
	});

	it("totals a cart of 100 items", () => {
		expect(new Checkout(100).total()).toBe(300);
	});

	it("totals a cart of 101 items", () => {
		expect(new Checkout(101).total()).toBe(303);
	});

	it("totals a cart of 102 items", () => {
		expect(new Checkout(102).total()).toBe(306);
	});

	it("totals a cart of 103 items", () => {
		expect(new Checkout(103).total()).toBe(309);
	});

	it("totals a cart of 104 items", () => {
		expect(new Checkout(104).total()).toBe(312);
	});

	it("totals a cart of 105 items", () => {
		expect(new Checkout(105).total()).toBe(315);
	});

	it("totals a cart of 106 items", () => {
		expect(new Checkout(106).total()).toBe(318);
	});

	it("totals a cart of 107 items", () => {
		expect(new Checkout(107).total()).toBe(321);
	});

	it("totals a cart of 108 items", () => {
		expect(new Checkout(108).total()).toBe(324);
	});

	it("totals a cart of 109 items", () => {
		expect(new Checkout(109).total()).toBe(327);
	});

	it("totals a cart of 110 items", () => {
		expect(new Checkout(110).total()).toBe(330);
	});

	it("totals a cart of 111 items", () => {
		expect(new Checkout(111).total()).toBe(333);
	});

	it("totals a cart of 112 items", () => {
		expect(new Checkout(112).total()).toBe(336);
	});

	it("totals a cart of 113 items", () => {
		expect(new Checkout(113).total()).toBe(339);
	});

	it("totals a cart of 114 items", () => {
		expect(new Checkout(114).total()).toBe(342);
	});

	it("totals a cart of 115 items", () => {
		expect(new Checkout(115).total()).toBe(345);
	});

	it("totals a cart of 116 items", () => {
		expect(new Checkout(116).total()).toBe(348);
	});

	it("totals a cart of 117 items", () => {
		expect(new Checkout(117).total()).toBe(351);
	});

	it("totals a cart of 118 items", () => {
		expect(new Checkout(118).total()).toBe(354);
	});

	it("totals a cart of 119 items", () => {
		expect(new Checkout(119).total()).toBe(357);
	});

	it("totals a cart of 120 items", () => {
		expect(new Checkout(120).total()).toBe(360);
	});

	it("totals a cart of 121 items", () => {
		expect(new Checkout(121).total()).toBe(363);
	});

	it("totals a cart of 122 items", () => {
		expect(new Checkout(122).total()).toBe(366);
	});

	it("totals a cart of 123 items", () => {
		expect(new Checkout(123).total()).toBe(369);
	});

	it("totals a cart of 124 items", () => {
		expect(new Checkout(124).total()).toBe(372);
	});

	it("totals a cart of 125 items", () => {
		expect(new Checkout(125).total()).toBe(375);
	});

	it("totals a cart of 126 items", () => {
		expect(new Checkout(126).total()).toBe(378);
	});

	it("totals a cart of 127 items", () => {
		expect(new Checkout(127).total()).toBe(381);
	});

	it("totals a cart of 128 items", () => {
		expect(new Checkout(128).total()).toBe(384);
	});

	it("totals a cart of 129 items", () => {
		expect(new Checkout(129).total()).toBe(387);
	});

	it("totals a cart of 130 items", () => {
		expect(new Checkout(130).total()).toBe(390);
	});

	it("totals a cart of 131 items", () => {
		expect(new Checkout(131).total()).toBe(393);
	});

	it("totals a cart of 132 items", () => {
		expect(new Checkout(132).total()).toBe(396);
	});

	it("totals a cart of 133 items", () => {
		expect(new Checkout(133).total()).toBe(399);
	});

	it("totals a cart of 134 items", () => {
		expect(new Checkout(134).total()).toBe(402);
	});

	it("totals a cart of 135 items", () => {
		expect(new Checkout(135).total()).toBe(405);
	});

	it("totals a cart of 136 items", () => {
		expect(new Checkout(136).total()).toBe(408);
	});

	it("totals a cart of 137 items", () => {
		expect(new Checkout(137).total()).toBe(411);
	});

	it("totals a cart of 138 items", () => {
		expect(new Checkout(138).total()).toBe(414);
	});

	it("totals a cart of 139 items", () => {
		expect(new Checkout(139).total()).toBe(417);
	});

	it("totals a cart of 140 items", () => {
		expect(new Checkout(140).total()).toBe(420);
	});

	it("totals a cart of 141 items", () => {
		expect(new Checkout(141).total()).toBe(423);
	});

	it("totals a cart of 142 items", () => {
		expect(new Checkout(142).total()).toBe(426);
	});

	it("totals a cart of 143 items", () => {
		expect(new Checkout(143).total()).toBe(429);
	});

	it("totals a cart of 144 items", () => {
		expect(new Checkout(144).total()).toBe(432);
	});

	it("totals a cart of 145 items", () => {
		expect(new Checkout(145).total()).toBe(435);
	});

	it("totals a cart of 146 items", () => {
		expect(new Checkout(146).total()).toBe(438);
	});

	it("totals a cart of 147 items", () => {
		expect(new Checkout(147).total()).toBe(441);
	});

	it("totals a cart of 148 items", () => {
		expect(new Checkout(148).total()).toBe(444);
	});

	it("totals a cart of 149 items", () => {
		expect(new Checkout(149).total()).toBe(447);
	});

	it("totals a cart of 150 items", () => {
		expect(new Checkout(150).total()).toBe(450);
	});

	it("totals a cart of 151 items", () => {
		expect(new Checkout(151).total()).toBe(453);
	});

	it("totals a cart of 152 items", () => {
		expect(new Checkout(152).total()).toBe(456);
	});

	it("totals a cart of 153 items", () => {
		expect(new Checkout(153).total()).toBe(459);
	});

	it("totals a cart of 154 items", () => {
		expect(new Checkout(154).total()).toBe(462);
	});

	it("totals a cart of 155 items", () => {
		expect(new Checkout(155).total()).toBe(465);
	});

	it("totals a cart of 156 items", () => {
		expect(new Checkout(156).total()).toBe(468);
	});

	it("totals a cart of 157 items", () => {
		expect(new Checkout(157).total()).toBe(471);
	});

	it("totals a cart of 158 items", () => {
		expect(new Checkout(158).total()).toBe(474);
	});

	it("totals a cart of 159 items", () => {
		expect(new Checkout(159).total()).toBe(477);
	});

	it("totals a cart of 160 items", () => {
		expect(new Checkout(160).total()).toBe(480);
	});

	it("totals a cart of 161 items", () => {
		expect(new Checkout(161).total()).toBe(483);
	});

	it("totals a cart of 162 items", () => {
		expect(new Checkout(162).total()).toBe(486);
	});

	it("totals a cart of 163 items", () => {
		expect(new Checkout(163).total()).toBe(489);
	});

	it("totals a cart of 164 items", () => {
		expect(new Checkout(164).total()).toBe(492);
	});

	it("totals a cart of 165 items", () => {
		expect(new Checkout(165).total()).toBe(495);
	});

	it("totals a cart of 166 items", () => {
		expect(new Checkout(166).total()).toBe(498);
	});

	it("totals a cart of 167 items", () => {
		expect(new Checkout(167).total()).toBe(501);
	});

	it("totals a cart of 168 items", () => {
		expect(new Checkout(168).total()).toBe(504);
	});

	it("totals a cart of 169 items", () => {
		expect(new Checkout(169).total()).toBe(507);
	});

});
